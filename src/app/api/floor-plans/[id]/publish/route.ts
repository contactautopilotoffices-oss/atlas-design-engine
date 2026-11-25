import { z } from "zod";
import { readJson, route } from "@/modules/core/api";
import { publishPlan } from "@/modules/floorplans/service";
import { requireStaff } from "@/modules/security/auth";

/** Body: { publish: boolean }. Published plans are the only ones clients can open. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const a = await requireStaff(["admin"]);
  const { publish } = z.object({ publish: z.boolean() }).parse(await readJson(req));
  return { plan: await publishPlan(id, publish, `staff:${a.label}`) };
});
