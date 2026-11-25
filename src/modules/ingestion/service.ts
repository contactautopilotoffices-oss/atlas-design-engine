import "server-only";
import { audit } from "@/modules/core/audit";
import { env } from "@/modules/core/env";
import { ReferenceMetadata, SCHEMA_VERSION, type Project, type ReferenceAsset, type SourceDocument } from "@/modules/core/schemas";
import { AppError, formatReferenceCode, newId, notFound, now, sha256 } from "@/modules/core/util";
import { blobs, repo } from "@/modules/persistence";
import { extractPdf } from "./pdf";
import { extractPptx } from "./pptx";
import { prepareImage, type PreparedImage } from "./images";

/** Pictures inside PDFs/PPTX smaller than this on their longest side are logos, icons or key plans. */
export const MIN_DESIGN_SIDE = 600;
import { detectKind } from "./validate";

export type ProjectInput = Pick<Project, "name" | "clientName" | "propertyName" | "city" | "category">;

export async function createProject(input: ProjectInput, actor: string, isDemo = false) {
  const t = now();
  const p: Project = { id: newId("prj"), ...input, isDemo, createdAt: t, updatedAt: t };
  await repo().insert("projects", p);
  await audit("project.create", actor, "project", p.id, { name: p.name });
  return p;
}

export async function projectStats() {
  const [projects, docs, refs] = await Promise.all([repo().list("projects"), repo().list("sourceDocuments"), repo().list("references")]);
  return projects
    .map((p) => {
      const pd = docs.filter((d) => d.projectId === p.id);
      const pr = refs.filter((r) => r.projectId === p.id);
      const statuses = pd.map((d) => d.status);
      return {
        ...p,
        documents: pd.map((d) => ({ id: d.id, filename: d.filename, status: d.status, uploadedAt: d.uploadedAt, extractedImageCount: d.extractedImageCount })),
        lastUploadAt: pd.map((d) => d.uploadedAt).sort().at(-1) ?? null,
        processingStatus: !pd.length ? "no documents" : statuses.includes("processing") ? "processing" : statuses.includes("failed") ? "has failures" : statuses.includes("partial") ? "partial" : "processed",
        extractedImages: pr.length,
        reviewedReferences: pr.filter((r) => r.reviewStatus === "approved" || r.reviewStatus === "rejected").length,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const extFor = (kind: SourceDocument["kind"], mime: string) => (kind === "pdf" ? "pdf" : kind === "pptx" ? "pptx" : mime.split("/")[1].replace("jpeg", "jpg"));

export type IngestResult = {
  document: SourceDocument;
  alreadyProcessed: boolean;
  createdReferences: number;
  duplicateImages: number;
  skippedSmall?: number;
};

/**
 * Stores the original file, extracts images + text, and creates one source-linked
 * reference record per unique image. Re-uploading the same file to the same project
 * does not create duplicates.
 */
export async function ingestFile(args: { projectId: string; filename: string; data: Buffer; actor: string; isDemo?: boolean }): Promise<IngestResult> {
  const { projectId, filename, data, actor } = args;
  const project = await repo().get("projects", projectId);
  if (!project) throw notFound("Project");
  const maxBytes = env().ATLAS_MAX_UPLOAD_MB * 1024 * 1024;
  const { kind, mimeType } = await detectKind(filename, data, maxBytes);
  const fileHash = sha256(data);

  const existing = (await repo().list("sourceDocuments", { projectId })).find((d) => d.sha256 === fileHash);
  if (existing && existing.status === "processed")
    return { document: existing, alreadyProcessed: true, createdReferences: 0, duplicateImages: 0 };

  const docId = existing?.id ?? newId("doc");
  const blobKey = `${projectId}/${docId}.${extFor(kind, mimeType)}`;
  await blobs().put("source-documents", blobKey, data, mimeType);
  const base: SourceDocument = {
    id: docId,
    projectId,
    filename,
    mimeType,
    kind,
    sizeBytes: data.length,
    sha256: fileHash,
    blobKey,
    status: "processing",
    pageCount: null,
    extractedImageCount: 0,
    duplicateImageCount: 0,
    skippedSmallCount: 0,
    pageText: [],
    errors: [],
    pdfScan: null,
    uploadedAt: existing?.uploadedAt ?? now(),
    processedAt: null,
  };
  if (existing) await repo().update("sourceDocuments", docId, base);
  else await repo().insert("sourceDocuments", base);

  const errors: SourceDocument["errors"] = [];
  const pageText: SourceDocument["pageText"] = [];
  type Candidate = { page: number | null; text: string; load: () => Promise<PreparedImage> };
  const candidates: Candidate[] = [];
  let pageCount: number | null = null;

  try {
    if (kind === "pdf") {
      const out = await extractPdf(data);
      pageCount = out.pageCount;
      for (const p of out.pages) {
        if (p.text) pageText.push({ page: p.page, text: p.text });
        if (p.error) errors.push({ page: p.page, message: p.error });
        for (const img of p.images) candidates.push({ page: p.page, text: p.text, load: () => prepareImage(img) });
      }
    } else if (kind === "pptx") {
      const out = await extractPptx(data);
      pageCount = out.slideCount;
      for (const s of out.slides) {
        if (s.text) pageText.push({ page: s.slide, text: s.text });
        for (const sk of s.skipped) errors.push({ page: s.slide, message: `Skipped ${sk}` });
        for (const img of s.images) candidates.push({ page: s.slide, text: s.text, load: () => prepareImage(img.data) });
      }
    } else {
      pageCount = null;
      candidates.push({ page: null, text: "", load: () => prepareImage(data) });
    }
  } catch (e) {
    const message = e instanceof AppError ? e.message : `Could not read this file: ${e instanceof Error ? e.message : "unknown error"}`;
    const failed = await repo().update("sourceDocuments", docId, { status: "failed", errors: [{ page: null, message }], processedAt: now() });
    await audit("document.failed", actor, "sourceDocument", docId, { filename });
    return { document: failed, alreadyProcessed: false, createdReferences: 0, duplicateImages: 0 };
  }

  const known = new Set((await repo().list("references", { projectId })).map((r) => r.imageSha256));
  let created = 0;
  let duplicates = 0;
  let skippedSmall = 0;
  for (const c of candidates) {
    let img: PreparedImage;
    try {
      img = await c.load();
    } catch (e) {
      errors.push({ page: c.page, message: `Image could not be processed: ${e instanceof Error ? e.message : "unknown error"}` });
      continue;
    }
    if (kind !== "image" && Math.max(img.width, img.height) < MIN_DESIGN_SIDE) {
      skippedSmall++;
      continue;
    }
    const imgHash = img.pixelHash;
    if (known.has(imgHash)) {
      duplicates++;
      continue;
    }
    known.add(imgHash);
    const refId = newId("ref");
    const seq = await repo().nextSequence("reference");
    await blobs().put("reference-images", `${projectId}/${refId}.${img.ext}`, img.data, img.mimeType);
    await blobs().put("reference-thumbnails", `${projectId}/${refId}.webp`, img.thumb, "image/webp");
    const t = now();
    const [primary, secondary, tertiary] = img.palette.map((p) => p.hex);
    const metadata = ReferenceMetadata.parse({
      colors: { primary: primary ?? null, secondary: secondary ?? null, tertiary: tertiary ?? null, palette: img.palette },
    });
    const ref: ReferenceAsset = {
      id: refId,
      referenceCode: formatReferenceCode(seq),
      projectId,
      documentId: docId,
      sourceFilename: filename,
      sourceKind: kind === "pdf" ? "pdf-page" : kind === "pptx" ? "pptx-slide" : "image-file",
      sourcePage: c.page,
      sourceText: c.text.slice(0, 4000),
      imageSha256: imgHash,
      blobKey: `${projectId}/${refId}.${img.ext}`,
      thumbKey: `${projectId}/${refId}.webp`,
      mimeType: img.mimeType,
      width: img.width,
      height: img.height,
      metadata,
      provenance: { "colors.primary": "observed", "colors.secondary": "observed", "colors.tertiary": "observed", "colors.palette": "observed" },
      analysis: { provider: null, status: "not_configured", error: null, analysedAt: null, imageRole: null, summary: null },
      reviewStatus: "pending",
      reviewedBy: null,
      reviewedAt: null,
      isDemo: Boolean(args.isDemo),
      schemaVersion: SCHEMA_VERSION,
      createdAt: t,
      updatedAt: t,
    };
    await repo().insert("references", ref);
    created++;
  }

  const status: SourceDocument["status"] =
    created + duplicates + skippedSmall === 0 && candidates.length > 0 ? "failed" : errors.length ? "partial" : "processed";
  if (candidates.length === 0) errors.push({ page: null, message: "No embedded raster images were found in this file." });
  const docRefCount = (await repo().list("references", { documentId: docId })).length;
  const doc = await repo().update("sourceDocuments", docId, {
    status: candidates.length === 0 ? "partial" : status,
    pageCount,
    pageText,
    errors,
    extractedImageCount: docRefCount,
    duplicateImageCount: duplicates,
    skippedSmallCount: skippedSmall,
    processedAt: now(),
  });
  await audit("document.ingest", actor, "sourceDocument", docId, { filename, created, duplicates, errors: errors.length });
  return { document: doc, alreadyProcessed: false, createdReferences: created, duplicateImages: duplicates, skippedSmall };
}

/**
 * Shared cascade removal for a set of ReferenceAsset records.
 * Protects client selections unless `force: true` is passed, and cleans up
 * design directions, offerings, and image/thumbnail blobs.
 */
async function removeReferencesWithLinks(refsToRemove: ReferenceAsset[], opts: { force?: boolean } = {}) {
  if (!refsToRemove.length) return;
  const r = repo();
  const refIds = new Set(refsToRemove.map((x) => x.id));
  const [selections, revisions, directions, offerings] = await Promise.all([
    r.list("selections"),
    r.list("selectionRevisions"),
    r.list("designDirections"),
    r.list("offerings"),
  ]);
  const usedSelections = selections.filter((s) => refIds.has(s.referenceId));
  const usedRevisions = revisions.filter((v) => refIds.has(v.referenceId));
  if (!opts.force && (usedSelections.length || usedRevisions.length)) {
    const sessionIds = new Set([...usedSelections.map((s) => s.sessionId), ...usedRevisions.map((v) => v.sessionId)]);
    throw new AppError(
      `Used in ${sessionIds.size} client design session(s). Confirm force delete to also remove those room selections, or delete the session(s) first.`,
      409,
      "reference_in_use",
    );
  }
  for (const rev of usedRevisions) await r.remove("selectionRevisions", rev.id);
  for (const sel of usedSelections) await r.remove("selections", sel.id);
  for (const d of directions) {
    if (d.referenceIds.some((id) => refIds.has(id))) {
      await r.update("designDirections", d.id, { referenceIds: d.referenceIds.filter((id) => !refIds.has(id)), updatedAt: now() });
    }
  }
  for (const o of offerings) {
    const inc = o.rules.includeReferenceIds.filter((id) => !refIds.has(id));
    const exc = o.rules.excludeReferenceIds.filter((id) => !refIds.has(id));
    if (inc.length !== o.rules.includeReferenceIds.length || exc.length !== o.rules.excludeReferenceIds.length) {
      await r.update("offerings", o.id, { rules: { ...o.rules, includeReferenceIds: inc, excludeReferenceIds: exc }, updatedAt: now() });
    }
  }
  for (const ref of refsToRemove) {
    await Promise.all([
      blobs().remove("reference-images", ref.blobKey).catch(() => undefined),
      blobs().remove("reference-thumbnails", ref.thumbKey).catch(() => undefined),
    ]);
    await r.remove("references", ref.id);
  }
}

export async function deleteReference(id: string, actor: string, opts: { force?: boolean } = {}) {
  return repo().exclusive("ingestion-delete", async () => {
    const ref = await repo().get("references", id);
    if (!ref) throw notFound("Reference");
    await removeReferencesWithLinks([ref], opts);
    const doc = await repo().get("sourceDocuments", ref.documentId);
    if (doc) {
      const remaining = (await repo().list("references", { documentId: doc.id })).length;
      await repo().update("sourceDocuments", doc.id, { extractedImageCount: remaining });
    }
    await audit("reference.delete", actor, "reference", id, { referenceCode: ref.referenceCode, projectId: ref.projectId });
  });
}

export async function deleteDocument(id: string, actor: string, opts: { force?: boolean } = {}) {
  return repo().exclusive("ingestion-delete", async () => {
    const doc = await repo().get("sourceDocuments", id);
    if (!doc) throw notFound("Document");
    const refs = await repo().list("references", { documentId: id });
    await removeReferencesWithLinks(refs, opts);
    await blobs().remove("source-documents", doc.blobKey).catch(() => undefined);
    await repo().remove("sourceDocuments", id);
    await audit("document.delete", actor, "sourceDocument", id, { filename: doc.filename, projectId: doc.projectId, referencesRemoved: refs.length });
  });
}

export async function deleteProject(id: string, actor: string, opts: { force?: boolean } = {}) {
  return repo().exclusive("ingestion-delete", async () => {
    const project = await repo().get("projects", id);
    if (!project) throw notFound("Project");
    const [refs, docs] = await Promise.all([repo().list("references", { projectId: id }), repo().list("sourceDocuments", { projectId: id })]);
    await removeReferencesWithLinks(refs, opts);
    for (const d of docs) {
      await blobs().remove("source-documents", d.blobKey).catch(() => undefined);
      await repo().remove("sourceDocuments", d.id);
    }
    await repo().remove("projects", id);
    await audit("project.delete", actor, "project", id, { name: project.name, documentsRemoved: docs.length, referencesRemoved: refs.length });
  });
}
