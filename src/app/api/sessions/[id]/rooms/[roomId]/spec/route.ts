import { readJson, route } from "@/modules/core/api";
import { getRoomSpec, saveRoomSpec } from "@/modules/spatial/service";

export const GET = route<{ id: string; roomId: string }>(async (_req, { id, roomId }) => getRoomSpec(id, roomId));
export const PUT = route<{ id: string; roomId: string }>(async (req, { id, roomId }) => ({ record: await saveRoomSpec(id, roomId, await readJson(req)) }));
