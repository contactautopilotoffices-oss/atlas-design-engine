import "server-only";
import { audit } from "@/modules/core/audit";
import { ReferenceMetadata, ReviewStatus, type DesignDirection, type Offering, type ReferenceAsset } from "@/modules/core/schemas";
import { newId, notFound, now, AppError } from "@/modules/core/util";
import { checkEligibility, allMaterials } from "@/modules/offerings/eligibility";
import { repo } from "@/modules/persistence";
import { z } from "zod";
import { discoverDirections } from "./directions";
import { recurringPatterns, uniqueCharacteristics } from "./patterns";
import { matchesFilters, type ProjectLite, type ReferenceFilters } from "./search";
import { findSimilar } from "./similarity";
import { suggestRoomType, type RoomSuggestion } from "./suggest";

export type ReferenceView = {
  id: string;
  referenceCode: string;
  project: ProjectLite & { clientName: string; isDemo: boolean };
  roomTypeId: string | null;
  roomTypeName: string | null;
  directionId: string | null;
  directionName: string | null;
  materials: string[];
  palette: Array<{ hex: string; share: number }>;
  source: { filename: string; page: number | null; kind: ReferenceAsset["sourceKind"]; documentId: string };
  thumbUrl: string;
  imageUrl: string;
  width: number;
  height: number;
  reviewStatus: ReferenceAsset["reviewStatus"];
  eligibility: Array<{ offeringId: string; offeringName: string; eligible: boolean; reasons: string[] }>;
  metadata: ReferenceAsset["metadata"];
  provenance: ReferenceAsset["provenance"];
  analysis: ReferenceAsset["analysis"];
  sourceText: string;
  isDemo: boolean;
  /** Room type suggested from the source page text (never applied without a person confirming). */
  suggestion: RoomSuggestion;
};

export async function loadLibraryContext() {
  const r = repo();
  const [refs, projects, roomTypes, directions, offerings] = await Promise.all([
    r.list("references"),
    r.list("projects"),
    r.list("roomTypes"),
    r.list("designDirections"),
    r.list("offerings"),
  ]);
  return { refs, projects, roomTypes, directions, offerings };
}

type Ctx = Awaited<ReturnType<typeof loadLibraryContext>>;

export function toView(ref: ReferenceAsset, ctx: Ctx): ReferenceView {
  const p = ctx.projects.find((x) => x.id === ref.projectId);
  return {
    id: ref.id,
    referenceCode: ref.referenceCode,
    project: { id: ref.projectId, name: p?.name ?? "Unknown project", propertyName: p?.propertyName ?? "", city: p?.city ?? "", clientName: p?.clientName ?? "", isDemo: p?.isDemo ?? false },
    roomTypeId: ref.metadata.roomTypeId,
    roomTypeName: ctx.roomTypes.find((x) => x.id === ref.metadata.roomTypeId)?.name ?? null,
    directionId: ref.metadata.designDirectionId,
    directionName: ctx.directions.find((x) => x.id === ref.metadata.designDirectionId)?.name ?? null,
    materials: Array.from(new Set(allMaterials(ref))),
    palette: ref.metadata.colors.palette,
    source: { filename: ref.sourceFilename, page: ref.sourcePage, kind: ref.sourceKind, documentId: ref.documentId },
    thumbUrl: `/api/assets/reference-thumbnails/${ref.thumbKey}`,
    imageUrl: `/api/assets/reference-images/${ref.blobKey}`,
    width: ref.width,
    height: ref.height,
    reviewStatus: ref.reviewStatus,
    eligibility: [...ctx.offerings]
      .sort((a, b) => a.rank - b.rank)
      .map((o) => ({ offeringId: o.id, offeringName: o.name, ...checkEligibility(ref, o, ctx.offerings) })),
    metadata: ref.metadata,
    provenance: ref.provenance,
    analysis: ref.analysis,
    sourceText: ref.sourceText,
    isDemo: ref.isDemo,
    suggestion: suggestRoomType(ref, ctx.roomTypes),
  };
}

export async function searchReferences(f: ReferenceFilters & { offeringId?: string; eligibleOnly?: boolean; limit?: number }) {
  const ctx = await loadLibraryContext();
  const offering: Offering | undefined = f.offeringId ? ctx.offerings.find((o) => o.id === f.offeringId) : undefined;
  if (f.offeringId && !offering) throw notFound("Offering");
  const lite = new Map(ctx.projects.map((p) => [p.id, p] as const));
  const out = ctx.refs
    .filter((r) => matchesFilters(r, f, lite.get(r.projectId)))
    .filter((r) => !(offering && f.eligibleOnly !== false) || checkEligibility(r, offering, ctx.offerings).eligible)
    .sort((a, b) => a.referenceCode.localeCompare(b.referenceCode))
    .slice(0, f.limit ?? 500)
    .map((r) => toView(r, ctx));
  return { references: out, total: out.length };
}

export async function getReferenceView(id: string) {
  const ctx = await loadLibraryContext();
  const ref = ctx.refs.find((r) => r.id === id);
  if (!ref) throw notFound("Reference");
  const doc = await repo().get("sourceDocuments", ref.documentId);
  const similar = findSimilar(ref, ctx.refs.filter((r) => r.reviewStatus !== "rejected"), { limit: 8 }).map((s) => ({
    ...s,
    reference: toView(ctx.refs.find((r) => r.id === s.referenceId)!, ctx),
  }));
  return { reference: toView(ref, ctx), document: doc ? { id: doc.id, filename: doc.filename, kind: doc.kind, pageCount: doc.pageCount } : null, similar };
}

export const MetadataUpdate = z.object({
  metadata: ReferenceMetadata.optional(),
  reviewStatus: ReviewStatus.optional(),
});

export async function updateReference(id: string, input: z.infer<typeof MetadataUpdate>, actor: string) {
  const ref = await repo().get("references", id);
  if (!ref) throw notFound("Reference");
  const patch: Partial<ReferenceAsset> = { updatedAt: now() };
  if (input.metadata) {
    const md = input.metadata;
    if (md.dimensions.length || md.dimensions.width || md.dimensions.height) {
      if (!md.dimensions.source)
        throw new AppError("Dimensions need a source (architectural drawing, supplied measurement or verified source text). They are never estimated from photos.");
    }
    patch.metadata = md;
    // Any field a person edits becomes human-provenance; untouched sampled colours stay "observed".
    const prov = { ...ref.provenance };
    const flat = (o: unknown, pre = ""): Record<string, string> =>
      o && typeof o === "object" && !Array.isArray(o)
        ? Object.entries(o).reduce((acc, [k, v]) => ({ ...acc, ...flat(v, pre ? `${pre}.${k}` : k) }), {})
        : { [pre]: JSON.stringify(o) };
    const before = flat(ref.metadata);
    const after = flat(md);
    for (const [k, v] of Object.entries(after)) if (before[k] !== v) prov[k.split(".").slice(0, 2).join(".")] = "human";
    patch.provenance = prov;
  }
  if (input.reviewStatus) {
    patch.reviewStatus = input.reviewStatus;
    patch.reviewedBy = actor;
    patch.reviewedAt = now();
  }
  const updated = await repo().update("references", id, patch);
  await audit("reference.update", actor, "reference", id, { reviewStatus: input.reviewStatus ?? null, metadataEdited: Boolean(input.metadata) });
  return updated;
}

export async function portfolioIntelligence() {
  const ctx = await loadLibraryContext();
  const usable = ctx.refs.filter((r) => r.reviewStatus !== "rejected");
  const name = (pid: string) => ctx.projects.find((p) => p.id === pid)?.name ?? pid;
  return {
    totals: {
      references: ctx.refs.length,
      approved: ctx.refs.filter((r) => r.reviewStatus === "approved").length,
      pending: ctx.refs.filter((r) => r.reviewStatus === "pending" || r.reviewStatus === "needs_review").length,
      projects: ctx.projects.length,
    },
    recurring: recurringPatterns(usable).slice(0, 40).map((p) => ({ ...p, projectNames: p.projects.map(name) })),
    unique: uniqueCharacteristics(usable).map((u) => ({ ...u, projectName: name(u.projectId) })),
    discovery: discoverDirections(usable),
    directions: ctx.directions,
    semanticSearch: { operational: false, reason: "No embedding provider is configured. Similarity shown here is attribute-based and explains its basis." },
  };
}

export const DirectionInput = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  status: z.enum(["suggested", "approved", "archived"]).default("suggested"),
  referenceIds: z.array(z.string()).default([]),
  signature: z.object({ materials: z.array(z.string()), keywords: z.array(z.string()), palette: z.array(z.string()) }).optional(),
  source: z.enum(["discovered", "manual", "merged"]).default("manual"),
});

export async function saveDirection(input: z.infer<typeof DirectionInput>, actor: string, id?: string) {
  const t = now();
  const d: DesignDirection = {
    id: id ?? newId("dir"),
    name: input.name,
    description: input.description,
    status: input.status,
    source: input.source,
    referenceIds: input.referenceIds,
    signature: input.signature ?? { materials: [], keywords: [], palette: [] },
    createdAt: t,
    updatedAt: t,
  };
  if (id) {
    const ex = await repo().get("designDirections", id);
    if (!ex) throw notFound("Design direction");
    d.createdAt = ex.createdAt;
    await repo().update("designDirections", id, d);
  } else await repo().insert("designDirections", d);
  // Approved directions are written onto their references so the gallery can filter by them.
  if (d.status === "approved")
    for (const rid of d.referenceIds) {
      const ref = await repo().get("references", rid);
      if (ref && ref.metadata.designDirectionId !== d.id)
        await repo().update("references", rid, { metadata: { ...ref.metadata, designDirectionId: d.id }, provenance: { ...ref.provenance, designDirectionId: "human" } });
    }
  await audit(id ? "direction.update" : "direction.create", actor, "designDirection", d.id, { name: d.name, status: d.status });
  return d;
}

export async function mergeDirections(ids: string[], name: string, actor: string) {
  const dirs = (await Promise.all(ids.map((i) => repo().get("designDirections", i)))).filter(Boolean) as DesignDirection[];
  if (dirs.length < 2) throw new AppError("Choose at least two directions to combine.");
  const merged = await saveDirection(
    {
      name,
      description: `Combined from: ${dirs.map((d) => d.name).join(", ")}`,
      status: "suggested",
      source: "merged",
      referenceIds: Array.from(new Set(dirs.flatMap((d) => d.referenceIds))),
      signature: {
        materials: Array.from(new Set(dirs.flatMap((d) => d.signature.materials))),
        keywords: Array.from(new Set(dirs.flatMap((d) => d.signature.keywords))),
        palette: Array.from(new Set(dirs.flatMap((d) => d.signature.palette))).slice(0, 6),
      },
    },
    actor,
  );
  for (const d of dirs) await repo().update("designDirections", d.id, { status: "archived", updatedAt: now() });
  return merged;
}

/** One-click review: set the room type and approve, or hide the picture (not a design). */
export async function quickReview(items: Array<{ id: string; roomTypeId: string | null }>, actor: string) {
  const roomTypes = await repo().list("roomTypes");
  let approved = 0;
  let hidden = 0;
  for (const it of items) {
    const ref = await repo().get("references", it.id);
    if (!ref) continue;
    if (it.roomTypeId && !roomTypes.some((r) => r.id === it.roomTypeId)) throw new AppError("Unknown room type.");
    if (it.roomTypeId) {
      await repo().update("references", ref.id, {
        metadata: { ...ref.metadata, roomTypeId: it.roomTypeId },
        provenance: { ...ref.provenance, roomTypeId: "human" },
        reviewStatus: "approved",
        reviewedBy: actor,
        reviewedAt: now(),
        updatedAt: now(),
      });
      approved++;
    } else {
      await repo().update("references", ref.id, { reviewStatus: "rejected", reviewedBy: actor, reviewedAt: now(), updatedAt: now() });
      hidden++;
    }
  }
  await audit("reference.quickReview", actor, "reference", null, { approved, hidden });
  return { approved, hidden };
}

export async function deleteDirection(id: string, actor: string) {
  const d = await repo().get("designDirections", id);
  if (!d) throw notFound("Design direction");
  const refs = await repo().list("references");
  for (const r of refs) {
    if (r.metadata.designDirectionId === id) {
      await repo().update("references", r.id, { metadata: { ...r.metadata, designDirectionId: null }, updatedAt: now() });
    }
  }
  await repo().remove("designDirections", id);
  await audit("direction.delete", actor, "designDirection", id, { name: d.name });
}
