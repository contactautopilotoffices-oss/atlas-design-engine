import "server-only";
import { audit } from "@/modules/core/audit";
import { calculateSessionBoq } from "@/modules/boq/calculator";
import type { DesignSelection, DesignSession, RoomSpec, SelectionRevision } from "@/modules/core/schemas";
import { AppError, forbidden, newId, notFound, now } from "@/modules/core/util";
import { materializePlanPreviewToSession } from "@/modules/generation/preview-cache";
import { higgsfieldStatus } from "@/modules/higgsfield/config";
import { loadLibraryContext, toView } from "@/modules/intelligence/library";
import { checkEligibility } from "@/modules/offerings/eligibility";
import { openaiStatus } from "@/modules/openai/config";
import { blobs, repo } from "@/modules/persistence";
import { clientTokenHash, currentActor, actorLabel } from "@/modules/security/auth";

export async function startSession(input: { propertyId: string; floorPlanId: string; offeringId: string; clientName?: string }) {
  const [prop, plan, off] = await Promise.all([
    repo().get("properties", input.propertyId),
    repo().get("floorPlans", input.floorPlanId),
    repo().get("offerings", input.offeringId),
  ]);
  if (!prop) throw notFound("Property");
  if (!plan || plan.propertyId !== prop.id) throw notFound("Floor plan");
  if (plan.status === "draft") throw new AppError("This floor plan is still being checked and is not open to clients yet.", 409);
  if (!off) throw notFound("Offering");
  const tokenHash = (await clientTokenHash(true))!;
  const t = now();
  const s: DesignSession = {
    id: newId("ses"),
    ownerTokenHash: tokenHash,
    propertyId: prop.id,
    floorPlanId: plan.id,
    offeringId: off.id,
    clientName: input.clientName ?? "",
    status: "active",
    createdAt: t,
    updatedAt: t,
  };
  await repo().insert("designSessions", s);
  await audit("session.start", "client", "designSession", s.id, { propertyId: prop.id, offeringId: off.id });
  return s;
}

/** Ownership check: the browser that created the session, or signed-in staff. */
export async function getAuthorisedSession(sessionId: string) {
  const s = await repo().get("designSessions", sessionId);
  if (!s) throw notFound("Design session");
  const actor = await currentActor();
  if (actor.kind === "staff") return { session: s, actor };
  const hash = await clientTokenHash(false);
  if (!hash || hash !== s.ownerTokenHash) throw forbidden("This design session belongs to another browser.");
  return { session: s, actor };
}

export async function mySessions() {
  const hash = await clientTokenHash(false);
  if (!hash) return [];
  return (await repo().list("designSessions", { ownerTokenHash: hash })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function setSessionOffering(sessionId: string, offeringId: string) {
  await getAuthorisedSession(sessionId);
  if (!(await repo().get("offerings", offeringId))) throw notFound("Offering");
  return repo().update("designSessions", sessionId, { offeringId, updatedAt: now() });
}

/**
 * Submit Choice: the only action that persists a selection. Creates revision 1 for a new room,
 * or the next revision for an existing one. Runs under the store's exclusive lock so two
 * concurrent submits can never produce the same revision number.
 */
export async function submitChoice(
  sessionId: string,
  input: { roomId: string; referenceId?: string; generatedAssetId?: string | null; previewId?: string | null; tierOfferingId?: string | null; note?: string },
) {
  const { session, actor } = await getAuthorisedSession(sessionId);
  const plan = await repo().get("floorPlans", session.floorPlanId);
  const room = plan?.rooms.find((r) => r.id === input.roomId);
  if (!room) throw notFound("Room");
  const ctx = await loadLibraryContext();
  // Choosing an AI concept: it stays linked to the library reference it was generated from.
  let referenceId = input.referenceId ?? null;
  let generatedAssetId: string | null = null;
  let chosenTierOfferingId: string | null = null;

  let targetAssetId = input.generatedAssetId ?? null;
  if (!targetAssetId && input.previewId) {
    const preview = (plan?.previews ?? []).find((p) => p.id === input.previewId && p.roomId === room.id);
    if (!preview) throw notFound("Cached room preview");
    const mat = await materializePlanPreviewToSession(sessionId, preview);
    if (!mat) throw notFound("Cached room preview image");
    targetAssetId = mat.id;
  }

  if (targetAssetId) {
    const asset = await repo().get("generatedAssets", targetAssetId);
    if (!asset || asset.sessionId !== sessionId || asset.roomId !== room.id) throw notFound("Generated design");
    const job = await repo().get("generationJobs", asset.jobId);
    referenceId = job?.referenceInputs.find((r) => r.kind === "reference")?.referenceId ?? null;
    if (!referenceId) throw new AppError("This AI design has no source reference to link to.", 409);
    generatedAssetId = asset.id;
    chosenTierOfferingId = asset.tierOfferingId ?? job?.tierOfferingId ?? input.tierOfferingId ?? null;
  } else if (input.tierOfferingId) {
    chosenTierOfferingId = input.tierOfferingId;
  }

  if (!referenceId) throw new AppError("Choose a design first.");
  const ref = ctx.refs.find((r) => r.id === referenceId);
  if (!ref) throw notFound("Reference");
  const baseOffering = ctx.offerings.find((o) => o.id === session.offeringId);
  if (!baseOffering) throw notFound("Offering");
  const chosenOffering = chosenTierOfferingId ? ctx.offerings.find((o) => o.id === chosenTierOfferingId) ?? baseOffering : baseOffering;
  if (ref.metadata.roomTypeId !== room.roomTypeId)
    throw new AppError("This reference is for a different room type than the selected room.", 409, "room_type_mismatch");
  if (!generatedAssetId) {
    const elig = checkEligibility(ref, chosenOffering, ctx.offerings);
    if (!elig.eligible) throw new AppError(`This reference is not available under ${chosenOffering.name}: ${elig.reasons.join(" ")}`, 409, "not_eligible");
  }
  const project = ctx.projects.find((p) => p.id === ref.projectId);
  const snapshot = {
    referenceCode: ref.referenceCode,
    projectId: ref.projectId,
    projectName: project?.name ?? "",
    sourceFilename: ref.sourceFilename,
    sourcePage: ref.sourcePage,
  };

  return repo().exclusive(`selection:${sessionId}:${room.id}`, async () => {
    const existing = (await repo().list("selections", { sessionId })).find((s) => s.roomId === room.id);
    const revisions = (await repo().list("selectionRevisions", { sessionId })).filter((r) => r.roomId === room.id);
    const revision = Math.max(existing?.revision ?? 0, ...revisions.map((r) => r.revision)) + 1;
    const t = now();
    const selection: DesignSelection = {
      id: existing?.id ?? newId("sel"),
      sessionId,
      roomId: room.id,
      roomTypeId: room.roomTypeId,
      referenceId: ref.id,
      generatedAssetId,
      snapshot,
      offeringId: chosenOffering.id,
      revision,
      submittedAt: t,
    };
    if (existing) await repo().update("selections", existing.id, selection);
    else await repo().insert("selections", selection);
    const rev: SelectionRevision = { ...selection, id: newId("rev"), selectionId: selection.id, note: input.note ?? "" };
    await repo().insert("selectionRevisions", rev);
    await repo().update("designSessions", sessionId, { updatedAt: t });
    await audit("selection.submit", actorLabel(actor), "designSelection", selection.id, { roomId: room.id, referenceId: ref.id, generatedAssetId, revision });
    return { selection, revision: rev };
  });
}

export async function sessionSummary(sessionId: string) {
  const { session } = await getAuthorisedSession(sessionId);
  const ctx = await loadLibraryContext();
  const [plan, property, selections, revisions, specs, jobs, assets, reviews, boqItems, settings] = await Promise.all([
    repo().get("floorPlans", session.floorPlanId),
    repo().get("properties", session.propertyId),
    repo().list("selections", { sessionId }),
    repo().list("selectionRevisions", { sessionId }),
    repo().list("roomSpecs", { sessionId }),
    repo().list("generationJobs", { sessionId }),
    repo().list("generatedAssets", { sessionId }),
    repo().list("designerReviews", { sessionId }),
    repo().list("boqItems"),
    repo().get("settings", "app"),
  ]);
  const offering = ctx.offerings.find((o) => o.id === session.offeringId) ?? null;
  const sortedOfferings = [...ctx.offerings].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const offeringMap = new Map(sortedOfferings.map((o) => [o.id, o]));
  const currency = settings?.currency ?? "INR";
  const specsByRoom: Record<string, RoomSpec | null> = {};
  for (const s of specs) specsByRoom[s.roomId] = s.spec;
  const selectedOfferingByRoom: Record<string, { offeringId: string; isChosen: boolean }> = {};
  for (const s of selections) selectedOfferingByRoom[s.roomId] = { offeringId: s.offeringId, isChosen: true };

  const boqSummary = calculateSessionBoq({
    rooms: plan?.rooms ?? [],
    planUnit: plan?.unit ?? "m",
    roomTypes: ctx.roomTypes,
    specsByRoom,
    selectedOfferingByRoom,
    defaultOfferingId: session.offeringId,
    offerings: sortedOfferings,
    boqItems,
    currency,
  });

  const refView = (id: string) => {
    const r = ctx.refs.find((x) => x.id === id);
    return r ? toView(r, ctx) : null;
  };
  const genUrl = (id: string | null | undefined) => {
    const a = id ? assets.find((x) => x.id === id) : null;
    return a ? `/api/assets/generated-images/${a.blobKey}` : null;
  };
  const aiConfigured = openaiStatus().configured || higgsfieldStatus().configured;

  const rooms = (plan?.rooms ?? []).map((room) => {
    const sel = selections.find((s) => s.roomId === room.id) ?? null;
    const roomBoqSummary = boqSummary.rooms.find((r) => r.roomId === room.id)!;
    const eligibleRefs = ctx.refs
      .filter((r) => r.metadata.roomTypeId === room.roomTypeId && r.reviewStatus === "approved" && (!offering || checkEligibility(r, offering, ctx.offerings).eligible))
      .sort((a, b) => Number(b.id === sel?.referenceId) - Number(a.id === sel?.referenceId) || a.referenceCode.localeCompare(b.referenceCode));
    const fallbackRefs = ctx.refs
      .filter((r) => r.metadata.roomTypeId === room.roomTypeId && r.reviewStatus === "approved")
      .sort((a, b) => a.referenceCode.localeCompare(b.referenceCode));
    const primaryRef = eligibleRefs[0] ?? fallbackRefs[0] ?? null;

    const roomJobs = jobs.filter((j) => j.roomId === room.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const roomAssets = assets.filter((a) => a.roomId === room.id && a.reviewStatus !== "rejected").sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const tierPreviews = sortedOfferings.map((o) => {
      const tierAssets = roomAssets
        .filter((a) => (a.tierOfferingId ?? roomJobs.find((j) => j.id === a.jobId)?.tierOfferingId ?? null) === o.id)
        .map((a) => {
          const job = roomJobs.find((j) => j.id === a.jobId);
          const refId = job?.referenceInputs.find((r) => r.kind === "reference")?.referenceId;
          return {
            id: a.id,
            previewId: null as string | null,
            generatedAssetId: a.id,
            referenceId: refId ?? null,
            url: `/api/assets/generated-images/${a.blobKey}`,
            tierOfferingId: o.id,
            tierName: o.name,
          };
        });
      const cached = (plan?.previews ?? [])
        .filter((p) => p.roomId === room.id && p.tierOfferingId === o.id && !tierAssets.length)
        .map((p) => ({
          id: p.id,
          previewId: p.id,
          generatedAssetId: null as string | null,
          referenceId: p.referenceId,
          url: `/api/assets/floor-plans/${p.blobKey}`,
          tierOfferingId: o.id,
          tierName: o.name,
        }));
      return {
        offering: { id: o.id, name: o.name, description: o.description, tierGuidance: o.tierGuidance, rank: o.rank, isDemo: o.isDemo },
        boq: roomBoqSummary.byOffering[o.id],
        images: [...tierAssets, ...cached],
      };
    });

    return {
      room,
      roomTypeName: ctx.roomTypes.find((t) => t.id === room.roomTypeId)?.name ?? room.roomTypeId,
      originalReference: primaryRef ? toView(primaryRef, ctx) : null,
      tierPreviews,
      metrics: roomBoqSummary.metrics,
      selectedBoq: roomBoqSummary.selectedBoq,
      selection: sel
        ? {
            ...sel,
            reference: refView(sel.referenceId),
            generatedImageUrl: genUrl(sel.generatedAssetId),
            offeringName: offeringMap.get(sel.offeringId)?.name ?? sel.offeringId,
          }
        : null,
      revisions: revisions
        .filter((r) => r.roomId === room.id)
        .sort((a, b) => b.revision - a.revision)
        .map((r) => ({ ...r, reference: refView(r.referenceId), generatedImageUrl: genUrl(r.generatedAssetId) })),
      spec: specs.find((s) => s.roomId === room.id) ?? null,
      jobs: roomJobs,
      assets: roomAssets,
      reviews: reviews.filter((r) => r.roomId === room.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  });
  return {
    session: { ...session, ownerTokenHash: undefined },
    property,
    floorPlan: plan,
    offering,
    offerings: sortedOfferings,
    currency,
    aiAvailable: aiConfigured,
    boqSummary,
    rooms,
  };
}

export async function deleteSession(sessionId: string) {
  const { actor } = await getAuthorisedSession(sessionId);
  await repo().exclusive(`session:${sessionId}`, async () => {
    const r = repo();
    const [reviews, assets, jobs, specs, revisions, selections] = await Promise.all([
      r.list("designerReviews", { sessionId }),
      r.list("generatedAssets", { sessionId }),
      r.list("generationJobs", { sessionId }),
      r.list("roomSpecs", { sessionId }),
      r.list("selectionRevisions", { sessionId }),
      r.list("selections", { sessionId }),
    ]);
    for (const a of assets) await blobs().remove("generated-images", a.blobKey).catch(() => undefined);
    for (const rv of reviews) await r.remove("designerReviews", rv.id);
    for (const a of assets) await r.remove("generatedAssets", a.id);
    for (const j of jobs) await r.remove("generationJobs", j.id);
    for (const sp of specs) await r.remove("roomSpecs", sp.id);
    for (const rev of revisions) await r.remove("selectionRevisions", rev.id);
    for (const sel of selections) await r.remove("selections", sel.id);
    await r.remove("designSessions", sessionId);
  });
  await audit("session.delete", actorLabel(actor), "designSession", sessionId);
}
