import { route } from "@/modules/core/api";
import { notFound } from "@/modules/core/util";
import { deleteDocument } from "@/modules/ingestion/service";
import { repo } from "@/modules/persistence";
import { requireStaff } from "@/modules/security/auth";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  await requireStaff();
  const doc = await repo().get("sourceDocuments", id);
  if (!doc) throw notFound("Document");
  return { document: doc, downloadUrl: `/api/assets/source-documents/${doc.blobKey}` };
});

export const DELETE = route<{ id: string }>(async (req, { id }) => {
  const a = await requireStaff(["admin"]);
  const force = new URL(req.url).searchParams.get("force") === "true";
  await deleteDocument(id, `staff:${a.label}`, { force });
  return { ok: true };
});
