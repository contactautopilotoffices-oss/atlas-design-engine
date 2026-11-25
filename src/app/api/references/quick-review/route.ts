import { z } from "zod";
import { readJson, route } from "@/modules/core/api";
import { quickReview } from "@/modules/intelligence/library";
import { requireStaff } from "@/modules/security/auth";

/** Body: { items: [{ id, roomTypeId }] }. roomTypeId null = hide (not a design). */
export const POST = route(async (req) => {
  const a = await requireStaff(["admin", "designer"]);
  const { items } = z.object({ items: z.array(z.object({ id: z.string(), roomTypeId: z.string().nullable() })).min(1).max(500) }).parse(await readJson(req));
  return quickReview(items, `staff:${a.label}`);
});
