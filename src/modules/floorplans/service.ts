import "server-only";
/**
 * Floor-plan import: upload a plan, find its rooms automatically, let a person check them,
 * then publish so clients can click the rooms.
 *  - DXF: rooms and sizes are read from the drawing itself (exact, no AI).
 *  - PDF / image: Claude reads the rooms off the picture; the size is an estimate until a person confirms it.
 */
import { audit } from "@/modules/core/audit";
import { env } from "@/modules/core/env";
import type { FloorPlan, FloorPlanRoom, Property, RoomType } from "@/modules/core/schemas";
import { AppError, newId, notFound, now } from "@/modules/core/util";
import { suggestRoomType } from "@/modules/intelligence/suggest";
import { blobs, repo } from "@/modules/persistence";
import { readPlanImage } from "./claude";
import { readDxf } from "./dxf";
import { planPictureFromImage, planPictureFromPdf, type PlanPicture } from "./source";

type Pt = [number, number];
const FALLBACK_TYPE = "rt_other";
const r2 = (n: number) => Math.round(n * 100) / 100;

export function detectPlanKind(fileName: string, buf: Buffer): "pdf" | "image" | "dxf" {
  if (!buf.length) throw new AppError(`"${fileName}" is empty.`);
  const head = buf.subarray(0, 6).toString("latin1");
  if (head.startsWith("%PDF-")) return "pdf";
  if (/^AC10\d\d/.test(head)) throw new AppError("This is a DWG file. Open it in AutoCAD, use File > Save As, choose an AutoCAD DXF format and upload the .dxf.", 415, "dwg");
  if (buf[0] === 0x89 && head.slice(1, 4) === "PNG") return "image";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image";
  if (head.startsWith("RIFF") && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image";
  const start = buf.subarray(0, 4096).toString("latin1");
  if (/^\s*0\s*\r?\n\s*SECTION/.test(start) || (fileName.toLowerCase().endsWith(".dxf") && /SECTION/.test(start))) return "dxf";
  if (start.startsWith("AutoCAD Binary DXF")) throw new AppError("This is a binary DXF. Please save it as an ASCII DXF and upload again.", 415, "binary_dxf");
  throw new AppError(`"${fileName}" is not a supported plan file. Use DXF, PDF, PNG, JPG or WEBP.`, 415, "unsupported_type");
}

function bounds(poly: Pt[]) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** Real sizes are only written once the plan's scale is known, never from a guess. */
function withDimensions(rooms: FloorPlanRoom[], scaleKnown: boolean): FloorPlanRoom[] {
  return rooms.map((room) => {
    if (!scaleKnown) return { ...room, dimensions: null };
    const { w, h } = bounds(room.polygon);
    if (w <= 0 || h <= 0) return { ...room, dimensions: null };
    return { ...room, dimensions: { length: r2(Math.max(w, h)), width: r2(Math.min(w, h)), height: room.dimensions?.height ?? null } };
  });
}

function typeFor(text: string, roomTypes: RoomType[]) {
  const hit = suggestRoomType({ sourceText: text, width: 4000, height: 4000 }, roomTypes).roomTypeId;
  if (hit) return hit;
  // Plans often write "4 SEATER WS" for small rooms full of desks.
  if (/\bws\b|seater\s*ws/i.test(text) && roomTypes.some((t) => t.id === "rt_workstations")) return "rt_workstations";
  return FALLBACK_TYPE;
}

function codes(rooms: Array<Omit<FloorPlanRoom, "code">>): FloorPlanRoom[] {
  return rooms.map((room, i) => ({ ...room, code: `R${String(i + 1).padStart(2, "0")}` }));
}

async function resolveProperty(input: { propertyId?: string | null; newPropertyName?: string | null; city?: string | null }): Promise<Property> {
  if (input.propertyId) {
    const p = await repo().get("properties", input.propertyId);
    if (!p) throw notFound("Property");
    return p;
  }
  const name = input.newPropertyName?.trim();
  if (!name) throw new AppError("Choose a property or type a name for a new one.");
  const t = now();
  const p: Property = { id: newId("prop"), name: name.slice(0, 120), city: input.city?.trim().slice(0, 80) ?? "", address: "", isDemo: false, createdAt: t, updatedAt: t };
  await repo().insert("properties", p);
  return p;
}

function fromReading(pic: PlanPicture, reading: Awaited<ReturnType<typeof readPlanImage>>, roomTypes: RoomType[]) {
  // Claude saw the smaller picture. Work in its pixels, then convert to metres.
  let mpp = reading.metresPerPixel;
  let note = reading.scaleNote;
  if (!mpp || mpp < 0.002 || mpp > 1) {
    mpp = 30 / pic.ai.width;
    note = "Claude could not judge the size, so the plan is assumed to be 30 m wide. Please enter the real width.";
  }
  const clampX = (x: number) => Math.max(0, Math.min(pic.ai.width, x));
  const clampY = (y: number) => Math.max(0, Math.min(pic.ai.height, y));
  const rooms = reading.rooms
    .map((f) => {
      const [x1, x2] = [clampX(Math.min(f.x1, f.x2)), clampX(Math.max(f.x1, f.x2))];
      const [y1, y2] = [clampY(Math.min(f.y1, f.y2)), clampY(Math.max(f.y1, f.y2))];
      if (x2 - x1 < 4 || y2 - y1 < 4) return null;
      const m = (v: number) => r2(v * mpp!);
      const polygon: Pt[] = [
        [m(x1), m(y1)],
        [m(x2), m(y1)],
        [m(x2), m(y2)],
        [m(x1), m(y2)],
      ];
      return {
        id: newId("rm"),
        name: f.name.slice(0, 80),
        roomTypeId: typeFor(`${f.name} ${f.label_text}`, roomTypes),
        polygon,
        dimensions: null,
        labelText: f.label_text.slice(0, 200),
        confidence: f.confidence,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  return {
    rooms,
    width: r2(pic.ai.width * mpp),
    height: r2(pic.ai.height * mpp),
    scale: { method: "ai_estimate" as const, metresPerPixel: mpp * (pic.ai.width / pic.full.width), note: note.slice(0, 400) },
  };
}

export async function importPlan(input: {
  fileName: string;
  data: Buffer;
  propertyId?: string | null;
  newPropertyName?: string | null;
  city?: string | null;
  page?: number | null;
  actor: string;
}) {
  const max = env().ATLAS_MAX_UPLOAD_MB * 1024 * 1024;
  if (input.data.length > max) throw new AppError(`"${input.fileName}" is larger than the ${env().ATLAS_MAX_UPLOAD_MB} MB upload limit.`, 413);
  const kind = detectPlanKind(input.fileName, input.data);
  const roomTypes = await repo().list("roomTypes");
  const id = newId("fp");
  const t = now();
  let plan: FloorPlan;
  let pages: PlanPicture["pages"] = [];
  let notes: string[] = [];

  if (kind === "dxf") {
    const d = readDxf(input.data.toString("utf8"));
    if (!d.rooms.length)
      throw new AppError(`Found ${d.outlinesFound} closed outlines but none had a room name written inside. Add room names as text inside each room, or upload a PDF of the plan instead.`, 422, "no_labels");
    const property = await resolveProperty(input);
    const rooms = codes(d.rooms.map((x) => ({ id: newId("rm"), name: x.name, roomTypeId: typeFor(x.labelText, roomTypes), polygon: x.polygon, dimensions: null, labelText: x.labelText.slice(0, 200), confidence: null })));
    plan = {
      id,
      propertyId: property.id,
      name: `${property.name} layout`,
      isSample: false,
      sampleNotice: "",
      unit: "m",
      width: d.width,
      height: d.height,
      rooms: withDimensions(rooms, d.unitsKnown),
      status: "draft",
      source: { kind, fileName: input.fileName.slice(0, 200), page: null },
      background: null,
      scale: { method: d.unitsKnown ? "drawing" : "ai_estimate", metresPerPixel: null, note: d.unitsNote },
      createdAt: t,
      updatedAt: t,
    };
    if (d.unlabelledOutlines) notes.push(`${d.unlabelledOutlines} outlines had no name inside and were skipped (usually furniture).`);
  } else {
    const pic = kind === "pdf" ? await planPictureFromPdf(input.data, input.page ?? null) : await planPictureFromImage(input.data);
    pages = pic.pages;
    const reading = await readPlanImage({ data: pic.ai.png, mimeType: "image/png", width: pic.ai.width, height: pic.ai.height });
    if (!reading.rooms.length) throw new AppError("No rooms were found on this page. If the PDF has several pages, pick the page with the layout.", 422, "no_rooms");
    const property = await resolveProperty(input);
    const r = fromReading(pic, reading, roomTypes);
    await blobs().put("floor-plans", `${id}/plan.png`, pic.full.png, "image/png");
    plan = {
      id,
      propertyId: property.id,
      name: `${property.name} layout`,
      isSample: false,
      sampleNotice: "",
      unit: "m",
      width: r.width,
      height: r.height,
      rooms: codes(r.rooms),
      status: "draft",
      source: { kind, fileName: input.fileName.slice(0, 200), page: pic.page },
      background: { key: `${id}/plan.png`, pixelWidth: pic.full.width, pixelHeight: pic.full.height },
      scale: r.scale,
      createdAt: t,
      updatedAt: t,
    };
    notes = [`Rooms read by ${reading.model}.`];
  }
  await repo().insert("floorPlans", plan);
  await audit("floorplan.import", input.actor, "floorPlan", plan.id, { kind, rooms: plan.rooms.length, fileName: input.fileName });
  return { plan, pages, notes };
}

const RoomEdit = (r: unknown) => r as { id?: string; name: string; roomTypeId: string; polygon: Pt[] };

/**
 * Saves a person's corrections: room names, types, outlines, and the real size of the plan.
 * Giving the real width rescales every room and marks the size as confirmed.
 */
export async function updatePlan(
  id: string,
  patch: { name?: string; rooms?: Array<{ id?: string; name: string; roomTypeId: string; polygon: Pt[] }>; realWidthMetres?: number; confirmScale?: boolean },
  actor: string,
) {
  return repo().exclusive(`floorplan:${id}`, async () => {
    const plan = await repo().get("floorPlans", id);
    if (!plan) throw notFound("Floor plan");
    if (plan.isSample) throw new AppError("The sample layout cannot be edited here.");
    const roomTypeIds = new Set((await repo().list("roomTypes")).map((x) => x.id));
    let rooms = plan.rooms;
    if (patch.rooms) {
      const old = new Map(plan.rooms.map((x) => [x.id, x]));
      rooms = codes(
        patch.rooms.map(RoomEdit).map((e) => {
          if (!roomTypeIds.has(e.roomTypeId)) throw new AppError(`Unknown room type for "${e.name}".`);
          const prev = e.id ? old.get(e.id) : undefined;
          const outlineChanged = !prev || JSON.stringify(prev.polygon) !== JSON.stringify(e.polygon);
          return {
            id: prev?.id ?? newId("rm"),
            name: e.name.trim().slice(0, 80) || "Room",
            roomTypeId: e.roomTypeId,
            polygon: e.polygon.map(([x, y]) => [r2(Math.max(0, Math.min(plan.width, x))), r2(Math.max(0, Math.min(plan.height, y)))] as Pt),
            dimensions: prev?.dimensions ?? null,
            labelText: prev?.labelText ?? "",
            confidence: outlineChanged ? null : (prev?.confidence ?? null),
          };
        }),
      );
    }
    let { width, height, scale } = plan;
    if (patch.realWidthMetres) {
      if (!(patch.realWidthMetres > 1 && patch.realWidthMetres < 2000)) throw new AppError("Enter the plan width in metres, for example 36.5.");
      const k = patch.realWidthMetres / plan.width;
      rooms = rooms.map((x) => ({ ...x, polygon: x.polygon.map(([a, b]) => [r2(a * k), r2(b * k)] as Pt) }));
      width = r2(width * k);
      height = r2(height * k);
      scale = { method: "confirmed", metresPerPixel: scale?.metresPerPixel ? scale.metresPerPixel * k : null, note: "Size entered by a person." };
    } else if (patch.confirmScale && scale) {
      scale = { ...scale, method: scale.method === "drawing" ? "drawing" : "confirmed", note: scale.method === "drawing" ? scale.note : "Size checked and confirmed by a person." };
    }
    const scaleKnown = scale?.method === "drawing" || scale?.method === "confirmed";
    const updated = await repo().update("floorPlans", id, {
      name: patch.name?.trim().slice(0, 120) || plan.name,
      rooms: withDimensions(rooms, scaleKnown),
      width,
      height,
      scale,
      updatedAt: now(),
    });
    await audit("floorplan.update", actor, "floorPlan", id, { rooms: rooms.length, rescaled: Boolean(patch.realWidthMetres) });
    return updated;
  });
}

export async function publishPlan(id: string, publish: boolean, actor: string) {
  const plan = await repo().get("floorPlans", id);
  if (!plan) throw notFound("Floor plan");
  if (publish) {
    if (!plan.rooms.length) throw new AppError("Add at least one room before publishing.");
    if (plan.scale?.method === "ai_estimate") throw new AppError("Check the plan size first: confirm the width or type the real width in metres.");
  }
  const updated = await repo().update("floorPlans", id, { status: publish ? "published" : "draft", updatedAt: now() });
  await audit(publish ? "floorplan.publish" : "floorplan.unpublish", actor, "floorPlan", id);
  return updated;
}

export async function deletePlan(id: string, actor: string) {
  const plan = await repo().get("floorPlans", id);
  if (!plan) throw notFound("Floor plan");
  if (plan.isSample) throw new AppError("The sample layout cannot be deleted here.");
  const used = (await repo().list("designSessions")).some((s) => s.floorPlanId === id);
  if (used) throw new AppError("Clients have already used this plan. Unpublish it instead of deleting.", 409);
  await repo().remove("floorPlans", id);
  if (plan.background) await blobs().remove("floor-plans", plan.background.key).catch(() => undefined);
  await audit("floorplan.delete", actor, "floorPlan", id);
}

export async function listPlans() {
  const [plans, properties] = await Promise.all([repo().list("floorPlans"), repo().list("properties")]);
  return plans
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((p) => ({ ...p, propertyName: properties.find((x) => x.id === p.propertyId)?.name ?? "" }));
}
