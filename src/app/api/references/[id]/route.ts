import { readJson, route } from "@/modules/core/api";
import { forbidden } from "@/modules/core/util";
import { deleteReference } from "@/modules/ingestion/service";
import { getReferenceView, MetadataUpdate, updateReference } from "@/modules/intelligence/library";
import { currentActor, requireStaff } from "@/modules/security/auth";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  const data = await getReferenceView(id);
  if ((await currentActor()).kind !== "staff") {
    if (data.reference.reviewStatus !== "approved") throw forbidden();
    return { ...data, similar: data.similar.filter((s) => s.reference.reviewStatus === "approved"), document: null };
  }
  return data;
});

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const a = await requireStaff(["admin", "designer"]);
  const body = MetadataUpdate.parse(await readJson(req));
  await updateReference(id, body, `staff:${a.label}`);
  return getReferenceView(id);
});

export const DELETE = route<{ id: string }>(async (req, { id }) => {
  const a = await requireStaff(["admin", "designer"]);
  const force = new URL(req.url).searchParams.get("force") === "true";
  await deleteReference(id, `staff:${a.label}`, { force });
  return { ok: true };
});
