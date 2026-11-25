import "server-only";
import { audit } from "@/modules/core/audit";
import { RoomSpec, type RoomSpecRecord } from "@/modules/core/schemas";
import { newId, notFound, now } from "@/modules/core/util";
import { repo } from "@/modules/persistence";
import { getAuthorisedSession } from "@/modules/selections/service";
import { classifyRoom } from "./classify";
import { hasErrors, validateRoomSpec } from "./validate";

export async function defaultSpec(sessionId: string, roomId: string): Promise<RoomSpec> {
  const { session } = await getAuthorisedSession(sessionId);
  const plan = await repo().get("floorPlans", session.floorPlanId);
  const room = plan?.rooms.find((r) => r.id === roomId);
  if (!room) throw notFound("Room");
  const xs = room.polygon.map((p) => p[0]);
  const ys = room.polygon.map((p) => p[1]);
  const d = room.dimensions;
  return RoomSpec.parse({
    unit: plan!.unit,
    length: d?.length ?? Math.max(...xs) - Math.min(...xs),
    width: d?.width ?? Math.max(...ys) - Math.min(...ys),
    height: d?.height ?? 3,
    roomTypeId: room.roomTypeId,
    intendedUse: "",
    occupancy: 0,
    doors: [],
    windows: [],
  });
}

export async function getRoomSpec(sessionId: string, roomId: string) {
  await getAuthorisedSession(sessionId);
  const rec = (await repo().list("roomSpecs", { sessionId })).find((r) => r.roomId === roomId) ?? null;
  return { record: rec, defaults: rec ? null : await defaultSpec(sessionId, roomId) };
}

export async function evaluate(spec: RoomSpec) {
  const roomTypes = await repo().list("roomTypes");
  const issues = validateRoomSpec(spec, roomTypes.find((r) => r.id === spec.roomTypeId) ?? null);
  const classification = classifyRoom(spec, roomTypes);
  for (const c of classification.contradictions) issues.push({ level: "review", field: "roomTypeId", message: c });
  return { issues, classification, isValid: !hasErrors(issues) };
}

export async function saveRoomSpec(sessionId: string, roomId: string, raw: unknown) {
  const { session } = await getAuthorisedSession(sessionId);
  const plan = await repo().get("floorPlans", session.floorPlanId);
  if (!plan?.rooms.some((r) => r.id === roomId)) throw notFound("Room");
  const spec = RoomSpec.parse(raw);
  const ev = await evaluate(spec);
  const existing = (await repo().list("roomSpecs", { sessionId })).find((r) => r.roomId === roomId);
  const rec: RoomSpecRecord = { id: existing?.id ?? newId("spec"), sessionId, roomId, spec, ...ev, updatedAt: now() };
  if (existing) await repo().update("roomSpecs", existing.id, rec);
  else await repo().insert("roomSpecs", rec);
  await audit("roomSpec.save", "client", "roomSpec", rec.id, { roomId, valid: ev.isValid });
  return rec;
}
