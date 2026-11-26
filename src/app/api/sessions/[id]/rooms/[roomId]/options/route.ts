import { z } from "zod";
import { readJson, route } from "@/modules/core/api";
import { generateRoomOptions, roomOptions } from "@/modules/generation/options";

export const maxDuration = 120;

export const GET = route<{ id: string; roomId: string }>(async (_req, { id, roomId }) => roomOptions(id, roomId));

/** Create new AI design options for this room. Body: { confirmed: true, count?: 1-4, modelId?: string, tierOfferingId?: string }. Uses provider credits. */
export const POST = route<{ id: string; roomId: string }>(async (req, { id, roomId }) => {
  const { confirmed, count, modelId, tierOfferingId } = z
    .object({ confirmed: z.boolean().default(false), count: z.number().int().min(1).max(4).default(4), modelId: z.string().optional(), tierOfferingId: z.string().nullable().optional() })
    .parse(await readJson(req));
  return generateRoomOptions(id, roomId, count, confirmed, modelId, tierOfferingId);
});
