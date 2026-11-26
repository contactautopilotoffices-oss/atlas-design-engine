import "server-only";
/**
 * Room options for the client popup: approved library pictures for the room's type (filtered by
 * offering), plus any AI designs already generated for this room, plus jobs still in progress.
 */
import { calculateRoomBoq, computeRoomMetrics } from "@/modules/boq/calculator";
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
  const [plan, boqItems, settings, specs, selections, jobs, assets] = await Promise.all([
    repo().get("floorPlans", session.floorPlanId),
    repo().list("boqItems"),
    repo().get("settings", "app"),
    repo().list("roomSpecs", { sessionId }),
    repo().list("selections", { sessionId }),
    repo().list("generationJobs", { sessionId }),
    repo().list("generatedAssets", { sessionId }),
  ]);
  const room = plan?.rooms.find((r) => r.id === roomId);
  if (!room || !plan) throw notFound("Room");
  const offering = ctx.offerings.find((o) => o.id === session.offeringId);
  const selection = selections.find((s) => s.roomId === roomId) ?? null;
  const specRec = specs.find((s) => s.roomId === roomId) ?? null;
  const roomType = ctx.roomTypes.find((t) => t.id === room.roomTypeId) ?? null;
  const sortedOfferings = [...ctx.offerings].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const offeringMap = new Map(sortedOfferings.map((o) => [o.id, o]));

  const library = ctx.refs
    .filter((r) => r.metadata.roomTypeId === room.roomTypeId && r.reviewStatus === "approved" && (!offering || checkEligibility(r, offering, ctx.offerings).eligible))
    .sort((a, b) => Number(b.id === selection?.referenceId) - Number(a.id === selection?.referenceId) || a.referenceCode.localeCompare(b.referenceCode))
    .map((r) => toView(r, ctx));
  const approvedAll = ctx.refs
    .filter((r) => r.metadata.roomTypeId === room.roomTypeId && r.reviewStatus === "approved")
    .sort((a, b) => a.referenceCode.localeCompare(b.referenceCode));
  const originalReference = library[0] ?? (approvedAll[0] ? toView(approvedAll[0], ctx) : null);

  const roomJobs = jobs.filter((j) => j.roomId === roomId);
  const roomAssets = assets.filter((a) => a.roomId === roomId && a.reviewStatus !== "rejected").sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const generated = roomAssets.map((a) => {
    const job = roomJobs.find((j) => j.id === a.jobId);
    const tierId = a.tierOfferingId ?? job?.tierOfferingId ?? null;
    const src = job?.referenceInputs.find((r) => r.kind === "reference")?.referenceId;
    const ref = src ? ctx.refs.find((r) => r.id === src) : null;
    return {
      id: a.id,
      url: `/api/assets/generated-images/${a.blobKey}`,
      createdAt: a.createdAt,
      reviewStatus: a.reviewStatus,
      tierOfferingId: tierId,
      tierName: tierId ? (offeringMap.get(tierId)?.name ?? null) : null,
      basedOn: ref ? `${ref.referenceCode} · ${ctx.projects.find((p) => p.id === ref.projectId)?.name ?? ""}` : null,
    };
  });

  const metrics = computeRoomMetrics(room, plan.unit, roomType, specRec?.spec ?? null);
  const currency = settings?.currency ?? "INR";

  const tiers = sortedOfferings.map((o) => {
    const tierGen = generated.filter((g) => g.tierOfferingId === o.id);
    const cached = (plan.previews ?? [])
      .filter((p) => p.roomId === roomId && p.tierOfferingId === o.id && !tierGen.some((g) => g.tierOfferingId === o.id))
      .map((p) => {
        const ref = ctx.refs.find((r) => r.id === p.referenceId);
        return {
          id: p.id,
          previewId: p.id,
          generatedAssetId: null as string | null,
          url: `/api/assets/floor-plans/${p.blobKey}`,
          tierOfferingId: o.id,
          tierName: o.name,
          basedOn: ref ? `${ref.referenceCode} · ${ctx.projects.find((pr) => pr.id === ref.projectId)?.name ?? ""}` : null,
        };
      });
    const tierImages = [
      ...tierGen.map((g) => ({
        id: g.id,
        previewId: null as string | null,
        generatedAssetId: g.id,
        url: g.url,
        tierOfferingId: o.id,
        tierName: o.name,
        basedOn: g.basedOn,
      })),
      ...cached,
    ];
    return {
      offering: { id: o.id, name: o.name, description: o.description, tierGuidance: o.tierGuidance, rank: o.rank, isDemo: o.isDemo },
      boq: calculateRoomBoq(metrics, o, boqItems, currency),
      images: tierImages,
    };
  });

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
    roomTypeName: roomType?.name ?? "",
    selection,
    library,
    originalReference,
    generated,
    tiers,
    metrics,
    currency,
    activeJobs: roomJobs.filter((j) => !["completed", "failed", "cancelled"].includes(j.status)).map((j) => ({ id: j.id, status: j.status, tierOfferingId: j.tierOfferingId ?? null, createdAt: j.createdAt })),
    failedRecently: roomJobs.filter((j) => j.status === "failed").sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 1).map((j) => j.error),
    ai: {
      available: anyConfigured && approvedAll.length > 0,
      reason: !anyConfigured
        ? "No AI image provider configured. Set OPENAI_API_KEY or Higgsfield credentials in .env."
        : approvedAll.length === 0
          ? "Approve at least one picture of this room type first."
          : null,
      defaultModelId: defaultModel.id,
      models,
    },
  };
}

export async function generateRoomOptions(sessionId: string, roomId: string, count: number, confirmed: boolean, modelId?: string, tierOfferingId?: string | null) {
  const settings = await repo().get("settings", "app");
  const model = resolveEffectiveModel(modelId, settings?.defaultModelId);
  return createGeneration(sessionId, roomId, { modelId: model.id, alternatives: count, roles: [], tierOfferingId: tierOfferingId ?? null, confirmed });
}
