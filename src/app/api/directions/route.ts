import { readJson, route } from "@/modules/core/api";
import { DirectionInput, saveDirection } from "@/modules/intelligence/library";
import { requireStaff } from "@/modules/security/auth";

export const POST = route(async (req) => {
  const a = await requireStaff(["admin"]);
  return { direction: await saveDirection(DirectionInput.parse(await readJson(req)), `staff:${a.label}`) };
});
