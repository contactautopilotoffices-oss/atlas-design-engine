import { readJson, route } from "@/modules/core/api";
import { deleteDirection, DirectionInput, saveDirection } from "@/modules/intelligence/library";
import { requireStaff } from "@/modules/security/auth";

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const a = await requireStaff(["admin"]);
  return { direction: await saveDirection(DirectionInput.parse(await readJson(req)), `staff:${a.label}`, id) };
});

export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  const a = await requireStaff(["admin"]);
  await deleteDirection(id, `staff:${a.label}`);
  return { ok: true };
});
