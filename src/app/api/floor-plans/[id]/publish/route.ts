import { z } from "zod";
import { readJson, route } from "@/modules/core/api";
import { getFloorPlanPreviewStatus } from "@/modules/generation/orchestrator";
import { publishPlan } from "@/modules/floorplans/service";
import { requireStaff } from "@/modules/security/auth";

/** Body: { publish: boolean, autoPreview?: boolean }. Published plans automatically start pre-rendering previews when OpenAI is configured. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const a = await requireStaff(["admin"]);
  const { publish, autoPreview } = z.object({ publish: z.boolean(), autoPreview: z.boolean().optional() }).parse(await readJson(req));
  const plan = await publishPlan(id, publish, `staff:${a.label}`, { autoPreview });
  const previewStatus = await getFloorPlanPreviewStatus(id).catch(() => null);
  return { plan, previewStatus };
});
