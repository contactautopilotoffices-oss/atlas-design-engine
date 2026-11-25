import "server-only";
import { deletePlan } from "@/modules/floorplans/service";
import { deleteProject } from "@/modules/ingestion/service";
import { blobs, repo } from "@/modules/persistence";
import { deleteSession } from "@/modules/selections/service";
import { audit } from "./audit";
import { Collections, type CollectionName } from "./schemas";
import { AppError, newId, notFound, now } from "./util";

/** Collections an admin may edit through the generic configuration API. */
export const CONFIG_COLLECTIONS = ["roomTypes", "materials", "offerings", "properties", "floorPlans", "projects", "settings"] as const;
export type ConfigCollection = (typeof CONFIG_COLLECTIONS)[number];
const PREFIX: Record<ConfigCollection, string> = { roomTypes: "rt", materials: "mat", offerings: "off", properties: "prop", floorPlans: "fp", projects: "prj", settings: "set" };

export function assertConfigCollection(c: string): asserts c is ConfigCollection {
  if (!(CONFIG_COLLECTIONS as readonly string[]).includes(c)) throw new AppError("Unknown configuration collection.", 404);
}

export async function createConfig(c: ConfigCollection, body: Record<string, unknown>, actor: string) {
  if (c === "settings") throw new AppError("Settings can only be updated.");
  const t = now();
  const rec = (Collections[c] as unknown as { parse: (x: unknown) => { id: string } }).parse({ ...body, id: newId(PREFIX[c]), createdAt: t, updatedAt: t });
  await repo().insert(c as CollectionName, rec as never);
  await audit(`config.${c}.create`, actor, c, rec.id);
  return rec;
}

export async function updateConfig(c: ConfigCollection, id: string, body: Record<string, unknown>, actor: string) {
  const ex = await repo().get(c as CollectionName, id);
  if (!ex) throw notFound("Record");
  const merged = (Collections[c] as unknown as { parse: (x: unknown) => unknown }).parse({ ...ex, ...body, id, updatedAt: now() });
  const out = await repo().update(c as CollectionName, id, merged as never);
  await audit(`config.${c}.update`, actor, c, id);
  return out;
}

export async function deleteConfig(c: ConfigCollection, id: string, actor: string, opts: { force?: boolean } = {}) {
  if (c === "settings") throw new AppError("Settings cannot be deleted.");
  if (c === "projects") return deleteProject(id, actor, opts);
  if (c === "floorPlans") return deletePlan(id, actor);
  const refs = await repo().list("references");
  if (c === "roomTypes" && refs.some((r) => r.metadata.roomTypeId === id)) throw new AppError("This room type is used by references. Reassign them first.", 409);
  if (c === "offerings" && (await repo().list("designSessions")).some((s) => s.offeringId === id)) throw new AppError("This offering is used by design sessions. Archive it by renaming instead.", 409);
  if (c === "properties") {
    const sessions = (await repo().list("designSessions")).filter((s) => s.propertyId === id);
    if (sessions.length && !opts.force) throw new AppError(`This property has ${sessions.length} design session(s). Delete those sessions first or force-delete.`, 409, "property_in_use");
    for (const s of sessions) await deleteSession(s.id);
    const plans = (await repo().list("floorPlans")).filter((f) => f.propertyId === id);
    for (const f of plans) {
      if (f.background) await blobs().remove("floor-plans", f.background.key).catch(() => undefined);
      await repo().remove("floorPlans", f.id);
    }
  }
  await repo().remove(c as CollectionName, id);
  await audit(`config.${c}.delete`, actor, c, id);
}
