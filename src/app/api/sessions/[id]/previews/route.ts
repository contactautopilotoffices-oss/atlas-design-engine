import { z } from "zod";
import { readJson, route } from "@/modules/core/api";
import { autoGenerateRoomPreviews, cancelSessionGeneration } from "@/modules/generation/orchestrator";
import { repo } from "@/modules/persistence";
import { getAuthorisedSession } from "@/modules/selections/service";

export const maxDuration = 300;

/** Pre-generates categorized previews across rooms in a design session so every hover opens immediately. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const { session } = await getAuthorisedSession(id);
  const raw = await readJson(req).catch(() => ({}));
  const body = z
    .object({
      roomIds: z.array(z.string()).optional(),
      tierIds: z.array(z.string()).optional(),
      modelId: z.string().optional(),
    })
    .parse(raw ?? {});
  const plan = await repo().get("floorPlans", session.floorPlanId);
  const rooms = (plan?.rooms ?? []).filter((r) => !body.roomIds?.length || body.roomIds.includes(r.id));
  const results = [];
  for (const room of rooms) {
    results.push(await autoGenerateRoomPreviews(id, room.id, { modelId: body.modelId, tierIds: body.tierIds }));
  }
  return { sessionId: id, rooms: results };
});

/** Stops all active AI image generation requests and cancels pending jobs for this session. */
export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  const { actor } = await getAuthorisedSession(id);
  return cancelSessionGeneration(id, actor);
});
