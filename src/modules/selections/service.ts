import "server-only";
import { audit } from "@/modules/core/audit";
import type { DesignSelection, DesignSession, SelectionRevision } from "@/modules/core/schemas";
import { AppError, forbidden, newId, notFound, now } from "@/modules/core/util";
import { loadLibraryContext, toView } from "@/modules/intelligence/library";
import { checkEligibility } from "@/modules/offerings/eligibility";
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
export async function submitChoice(sessionId: string, input: { roomId: string; referenceId?: string; generatedAssetId?: string | null; note?: string }) {
  const { session, actor } = await getAuthorisedSession(sessionId);
  const plan = await repo().get("floorPlans", session.floorPlanId);
  const room = plan?.rooms.find((r) => r.id === input.roomId);
  if (!room) throw notFound("Room");
  const ctx = await loadLibraryContext();
  // Choosing an AI concept: it stays linked to the library reference it was generated from.
  let referenceId = input.referenceId ?? null;
  let generatedAssetId: string | null = null;
  if (input.generatedAssetId) {
    const asset = await repo().get("generatedAssets", input.generatedAssetId);
    if (!asset || asset.sessionId !== sessionId || asset.roomId !== room.id) throw notFound("Generated design");
    const job = await repo().get("generationJobs", asset.jobId);
    referenceId = job?.referenceInputs.find((r) => r.kind === "reference")?.referenceId ?? null;
    if (!referenceId) throw new AppError("This AI design has no source reference to link to.", 409);
    generatedAssetId = asset.id;
  }
  if (!referenceId) throw new AppError("Choose a design first.");
  const ref = ctx.refs.find((r) => r.id === referenceId);
  if (!ref) throw notFound("Reference");
  const offering = ctx.offerings.find((o) => o.id === session.offeringId);
  if (!offering) throw notFound("Offering");
  if (ref.metadata.roomTypeId !== room.roomTypeId)
    throw new AppError("This reference is for a different room type than the selected room.", 409, "room_type_mismatch");
  const elig = checkEligibility(ref, offering, ctx.offerings);
  if (!elig.eligible) throw new AppError(`This reference is not available under ${offering.name}: ${elig.reasons.join(" ")}`, 409, "not_eligible");
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
      offeringId: offering.id,
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
  const [plan, property, selections, revisions, specs, jobs, assets, reviews] = await Promise.all([
    repo().get("floorPlans", session.floorPlanId),
    repo().get("properties", session.propertyId),
    repo().list("selections", { sessionId }),
    repo().list("selectionRevisions", { sessionId }),
    repo().list("roomSpecs", { sessionId }),
    repo().list("generationJobs", { sessionId }),
    repo().list("generatedAssets", { sessionId }),
    repo().list("designerReviews", { sessionId }),
  ]);
  const offering = ctx.offerings.find((o) => o.id === session.offeringId) ?? null;
  const refView = (id: string) => {
    const r = ctx.refs.find((x) => x.id === id);
    return r ? toView(r, ctx) : null;
  };
  const genUrl = (id: string | null | undefined) => {
    const a = id ? assets.find((x) => x.id === id) : null;
    return a ? `/api/assets/generated-images/${a.blobKey}` : null;
  };
  const rooms = (plan?.rooms ?? []).map((room) => {
    const sel = selections.find((s) => s.roomId === room.id) ?? null;
    return {
      room,
      roomTypeName: ctx.roomTypes.find((t) => t.id === room.roomTypeId)?.name ?? room.roomTypeId,
      selection: sel
        ? {
            ...sel,
            reference: refView(sel.referenceId),
            generatedImageUrl: genUrl(sel.generatedAssetId),
            offeringName: ctx.offerings.find((o) => o.id === sel.offeringId)?.name ?? sel.offeringId,
          }
        : null,
      revisions: revisions
        .filter((r) => r.roomId === room.id)
        .sort((a, b) => b.revision - a.revision)
        .map((r) => ({ ...r, reference: refView(r.referenceId), generatedImageUrl: genUrl(r.generatedAssetId) })),
      spec: specs.find((s) => s.roomId === room.id) ?? null,
      jobs: jobs.filter((j) => j.roomId === room.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      assets: assets.filter((a) => a.roomId === room.id),
      reviews: reviews.filter((r) => r.roomId === room.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  });
  return { session: { ...session, ownerTokenHash: undefined }, property, floorPlan: plan, offering, offerings: ctx.offerings, rooms };
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
