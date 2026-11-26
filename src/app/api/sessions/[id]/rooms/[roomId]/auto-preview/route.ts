import { z } from "zod";
import { readJson, route } from "@/modules/core/api";
import { autoGenerateRoomPreviews } from "@/modules/generation/orchestrator";

export const maxDuration = 120;

/** Ensures categorized AI previews (Economy, Premium Economy, ...) exist for one hovered/selected room. */
export const POST = route<{ id: string; roomId: string }>(async (req, { id, roomId }) => {
  const raw = await readJson(req).catch(() => ({}));
  const body = z
    .object({
      modelId: z.string().optional(),
      tierIds: z.array(z.string()).optional(),
    })
    .parse(raw ?? {});
  return autoGenerateRoomPreviews(id, roomId, body);
});
