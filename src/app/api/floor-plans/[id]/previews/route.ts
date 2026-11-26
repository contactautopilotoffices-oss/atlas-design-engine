import { z } from "zod";
import { readJson, route } from "@/modules/core/api";
import {
  cancelFloorPlanPreviewJob,
  generateFloorPlanPreviews,
  getFloorPlanPreviewStatus,
  startFloorPlanPreviewJob,
} from "@/modules/generation/orchestrator";
import { requireStaff } from "@/modules/security/auth";

export const maxDuration = 300;

/** Staff endpoint: check background AI preview generation progress for a floor plan. */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  await requireStaff(["admin", "designer"]);
  return getFloorPlanPreviewStatus(id);
});

/** Staff endpoint: pre-generate categorized AI previews on a floor plan (async background or awaited). */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const actor = await requireStaff(["admin", "designer"]);
  const raw = await readJson(req).catch(() => ({}));
  const body = z
    .object({
      roomIds: z.array(z.string()).optional(),
      tierOfferingIds: z.array(z.string()).optional(),
      modelId: z.string().optional(),
      force: z.boolean().optional(),
      async: z.boolean().optional(),
    })
    .parse(raw ?? {});
  if (body.async) return startFloorPlanPreviewJob(id, actor, body);
  return generateFloorPlanPreviews(id, actor, body);
});

/** Staff endpoint: immediately stop running floor-plan AI preview generation. */
export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  const actor = await requireStaff(["admin", "designer"]);
  return cancelFloorPlanPreviewJob(id, actor);
});
