import "server-only";
/**
 * Room options for the client popup: approved library pictures for the room's type (filtered by
 * offering), plus any AI designs already generated for this room, plus jobs still in progress.
 */
import { notFound } from "@/modules/core/util";
import { ALL_MODELS, modelProvider } from "@/modules/generation/models";
import { loadLibraryContext, toView } from "@/modules/intelligence/library";
import { checkEligibility } from "@/modules/offerings/eligibility";
import { repo } from "@/modules/persistence";
import { getAuthorisedSession } from "@/modules/selections/service";
import { createGeneration, providerStatuses, resolveEffectiveModel } from "./orchestrator";

export async function roomOptions(sessionId: string, roomId: string) {
  const { session } = await getAuthorisedSession(sessionId);
  const ctx = await loadLibraryContext();
  const plan = await repo().get("floorPlans", session.floorPlanId);
  const room = plan?.rooms.find((r) => r.id === roomId);
  if (!room) throw notFound("Room");
  const offering = ctx.offerings.find((o) => o.id === session.offeringId);
  const selection = (await repo().list("selections", { sessionId })).find((s) => s.roomId === roomId) ?? null;
  const library = ctx.refs
    .filter((r) => r.metadata.roomTypeId === room.roomTypeId && r.reviewStatus === "approved" && (!offering || checkEligibility(r, offering, ctx.offerings).eligible))
    .sort((a, b) => Number(b.id === selection?.referenceId) - Number(a.id === selection?.referenceId) || a.referenceCode.localeCompare(b.referenceCode))
    .map((r) => toView(r, ctx));
  const jobs = (await repo().list("generationJobs", { sessionId })).filter((j) => j.roomId === roomId);
  const assets = (await repo().list("generatedAssets", { sessionId })).filter((a) => a.roomId === roomId);
  const generated = assets
    .filter((a) => a.reviewStatus !== "rejected")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((a) => {
      const job = jobs.find((j) => j.id === a.jobId);
      const src = job?.referenceInputs.find((r) => r.kind === "reference")?.referenceId;
      const ref = src ? ctx.refs.find((r) => r.id === src) : null;
      return { id: a.id, url: `/api/assets/generated-images/${a.blobKey}`, createdAt: a.createdAt, reviewStatus: a.reviewStatus, basedOn: ref ? `${ref.referenceCode} · ${ctx.projects.find((p) => p.id === ref.projectId)?.name ?? ""}` : null };
    });
  const settings = await repo().get("settings", "app");
  const statuses = providerStatuses();
  const anyConfigured = statuses.higgsfield.configured || statuses.openai.configured;
  const defaultModel = resolveEffectiveModel(null, settings?.defaultModelId);
  const models = ALL_MODELS.map((m) => ({
    id: m.id,
    label: m.label,
    provider: modelProvider(m),
    configured: statuses[modelProvider(m)].configured,
  }));
  return {
    room,
    roomTypeName: ctx.roomTypes.find((t) => t.id === room.roomTypeId)?.name ?? "",
    selection,
    library,
    generated,
    activeJobs: jobs.filter((j) => !["completed", "failed", "cancelled"].includes(j.status)).map((j) => ({ id: j.id, status: j.status, createdAt: j.createdAt })),
    failedRecently: jobs.filter((j) => j.status === "failed").sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 1).map((j) => j.error),
    ai: {
      available: anyConfigured && library.length > 0,
      reason: !anyConfigured
        ? "No AI image provider configured. Set OPENAI_API_KEY or Higgsfield credentials in .env."
        : library.length === 0
          ? "Approve at least one picture of this room type first."
          : null,
      defaultModelId: defaultModel.id,
      models,
    },
  };
}

export async function generateRoomOptions(sessionId: string, roomId: string, count: number, confirmed: boolean, modelId?: string) {
  const settings = await repo().get("settings", "app");
  const model = resolveEffectiveModel(modelId, settings?.defaultModelId);
  return createGeneration(sessionId, roomId, { modelId: model.id, alternatives: count, roles: [], confirmed });
}
