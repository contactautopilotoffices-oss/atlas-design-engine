import { z } from "zod";
import { readJson, route } from "@/modules/core/api";
import { mergeDirections } from "@/modules/intelligence/library";
import { requireStaff } from "@/modules/security/auth";

export const POST = route(async (req) => {
  const a = await requireStaff(["admin"]);
  const { ids, name } = z.object({ ids: z.array(z.string()).min(2), name: z.string().min(1) }).parse(await readJson(req));
  return { direction: await mergeDirections(ids, name, `staff:${a.label}`) };
});
