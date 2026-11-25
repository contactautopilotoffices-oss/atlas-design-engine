import { z } from "zod";
import { readJson, route } from "@/modules/core/api";
import { submitChoice } from "@/modules/selections/service";

/** Submit Choice. The only endpoint that persists a room selection. It never starts image generation. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const input = z.object({ roomId: z.string(), referenceId: z.string().optional(), generatedAssetId: z.string().nullable().optional(), note: z.string().max(1000).optional() }).refine((v) => v.referenceId || v.generatedAssetId, "Choose a design first.").parse(await readJson(req));
  return submitChoice(id, input);
});
