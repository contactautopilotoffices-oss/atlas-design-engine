import { readJson, route } from "@/modules/core/api";
import { assertConfigCollection, deleteConfig, updateConfig } from "@/modules/core/admin";
import { requireStaff } from "@/modules/security/auth";

export const PATCH = route<{ collection: string; id: string }>(async (req, { collection, id }) => {
  const a = await requireStaff(["admin"]);
  assertConfigCollection(collection);
  return { item: await updateConfig(collection, id, await readJson(req), `staff:${a.label}`) };
});

export const DELETE = route<{ collection: string; id: string }>(async (req, { collection, id }) => {
  const a = await requireStaff(["admin"]);
  assertConfigCollection(collection);
  const force = new URL(req.url).searchParams.get("force") === "true";
  await deleteConfig(collection, id, `staff:${a.label}`, { force });
  return { ok: true };
});
