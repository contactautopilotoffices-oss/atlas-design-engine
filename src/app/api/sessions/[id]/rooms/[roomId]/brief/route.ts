import { readJson, route } from "@/modules/core/api";
import { previewBrief } from "@/modules/generation/orchestrator";

export const POST = route<{ id: string; roomId: string }>(async (req, { id, roomId }) => {
  const body = await readJson<Record<string, unknown>>(req);
  return previewBrief(id, roomId, body, typeof body.modelId === "string" ? body.modelId : undefined);
});
