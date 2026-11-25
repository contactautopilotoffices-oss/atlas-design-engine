import { route } from "@/modules/core/api";
import { visionStatus } from "@/modules/analysis/vision";
import { notFound } from "@/modules/core/util";
import { deleteProject } from "@/modules/ingestion/service";
import { repo } from "@/modules/persistence";
import { requireStaff } from "@/modules/security/auth";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  await requireStaff();
  const project = await repo().get("projects", id);
  if (!project) throw notFound("Project");
  const docs = (await repo().list("sourceDocuments", { projectId: id })).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  const refs = (await repo().list("references", { projectId: id })).sort((a, b) => a.referenceCode.localeCompare(b.referenceCode));
  const roomTypes = new Map((await repo().list("roomTypes")).map((rt) => [rt.id, rt.name]));
  return {
    project,
    aiConfigured: visionStatus().configured,
    documents: docs.map((d) => ({ ...d, pageText: d.pageText.slice(0, 200) })),
    references: refs.map((r) => ({
      id: r.id,
      referenceCode: r.referenceCode,
      documentId: r.documentId,
      sourceFilename: r.sourceFilename,
      sourceKind: r.sourceKind,
      sourcePage: r.sourcePage,
      thumbUrl: `/api/assets/reference-thumbnails/${r.thumbKey}`,
      imageUrl: `/api/assets/reference-images/${r.blobKey}`,
      width: r.width,
      height: r.height,
      reviewStatus: r.reviewStatus,
      roomTypeName: r.metadata.roomTypeId ? roomTypes.get(r.metadata.roomTypeId) ?? null : null,
      analysis: r.analysis,
    })),
    counts: { references: refs.length, approved: refs.filter((r) => r.reviewStatus === "approved").length, pending: refs.filter((r) => r.reviewStatus === "pending").length },
  };
});

export const DELETE = route<{ id: string }>(async (req, { id }) => {
  const a = await requireStaff(["admin"]);
  const force = new URL(req.url).searchParams.get("force") === "true";
  await deleteProject(id, `staff:${a.label}`, { force });
  return { ok: true };
});
