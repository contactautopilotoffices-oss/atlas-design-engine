/**
 * Measured-room validation. Pure and deterministic.
 * Internally everything is checked in metres; feet input is converted first.
 */
import type { Opening, RoomSpec, RoomType, ValidationIssue, Wall } from "@/modules/core/schemas";

export const FT = 0.3048;
export const toMetres = (spec: RoomSpec): RoomSpec => {
  if (spec.unit === "m") return spec;
  const k = FT;
  const o = (x: Opening) => ({ ...x, offset: x.offset * k, width: x.width * k, height: x.height * k, sillHeight: x.sillHeight * k });
  const b = <T extends { x: number; y: number; w: number; d: number; h: number | null }>(x: T) => ({ ...x, x: x.x * k, y: x.y * k, w: x.w * k, d: x.d * k, h: x.h == null ? null : x.h * k });
  return {
    ...spec,
    unit: "m",
    length: spec.length * k,
    width: spec.width * k,
    height: spec.height * k,
    doors: spec.doors.map(o),
    windows: spec.windows.map(o),
    columns: spec.columns.map(b),
    obstructions: spec.obstructions.map(b),
    furniture: spec.furniture.map((f) => ({ ...f, w: f.w * k, d: f.d * k, h: f.h * k })),
    circulationClearance: spec.circulationClearance * k,
  };
};

/** North and south walls run along the length (x); east and west run along the width (y). */
export const wallLength = (s: Pick<RoomSpec, "length" | "width">, w: Wall) => (w === "north" || w === "south" ? s.length : s.width);

export const LIMITS = { minSide: 1.5, maxSide: 120, minHeight: 2.2, maxHeight: 12, minDoorWidth: 0.7, minDoorHeight: 1.9 };

export function validateRoomSpec(input: RoomSpec, roomType?: RoomType | null): ValidationIssue[] {
  const s = toMetres(input);
  const issues: ValidationIssue[] = [];
  const err = (field: string, message: string) => issues.push({ level: "error", field, message });
  const warn = (field: string, message: string) => issues.push({ level: "warning", field, message });
  const review = (field: string, message: string) => issues.push({ level: "review", field, message });
  const u = (m: number) => `${(input.unit === "ft" ? m / FT : m).toFixed(2)} ${input.unit}`;

  for (const [k, v] of [["length", s.length], ["width", s.width]] as const) {
    if (!Number.isFinite(v) || v <= 0) err(k, `${k} must be a positive number.`);
    else if (v < LIMITS.minSide) err(k, `${k} of ${u(v)} is too small for a usable room (minimum ${u(LIMITS.minSide)}).`);
    else if (v > LIMITS.maxSide) err(k, `${k} of ${u(v)} is larger than this tool supports (${u(LIMITS.maxSide)}).`);
  }
  if (!Number.isFinite(s.height) || s.height <= 0) err("height", "Ceiling height must be a positive number.");
  else if (s.height < LIMITS.minHeight) err("height", `Ceiling height ${u(s.height)} is below the ${u(LIMITS.minHeight)} minimum for occupied rooms.`);
  else if (s.height > LIMITS.maxHeight) warn("height", `Ceiling height ${u(s.height)} is unusually high. Please confirm.`);
  if (issues.some((i) => i.level === "error")) return issues;

  const checkOpenings = (list: Opening[], kind: "door" | "window") => {
    list.forEach((o, i) => {
      const f = `${kind}s.${i}`;
      const wl = wallLength(s, o.wall);
      if (o.offset + o.width > wl + 1e-6) err(f, `${kind} ${i + 1} (${u(o.width)} wide at ${u(o.offset)}) does not fit on the ${o.wall} wall (${u(wl)}).`);
      const top = o.sillHeight + o.height;
      if (top > s.height + 1e-6) err(f, `${kind} ${i + 1} is taller than the ceiling (${u(top)} vs ${u(s.height)}).`);
      if (kind === "door") {
        if (o.width < LIMITS.minDoorWidth) warn(f, `Door ${i + 1} is narrower than ${u(LIMITS.minDoorWidth)}; check accessibility.`);
        if (o.height < LIMITS.minDoorHeight) warn(f, `Door ${i + 1} is lower than ${u(LIMITS.minDoorHeight)}.`);
        if (o.sillHeight > 0) warn(f, `Door ${i + 1} has a sill height above floor level.`);
      }
    });
  };
  checkOpenings(s.doors, "door");
  checkOpenings(s.windows, "window");
  const all = [...s.doors.map((d, i) => ({ ...d, label: `door ${i + 1}` })), ...s.windows.map((w, i) => ({ ...w, label: `window ${i + 1}` }))];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      if (a.wall !== b.wall) continue;
      const overlapX = a.offset < b.offset + b.width && b.offset < a.offset + a.width;
      const overlapY = a.sillHeight < b.sillHeight + b.height && b.sillHeight < a.sillHeight + a.height;
      if (overlapX && overlapY) err("openings", `${a.label} and ${b.label} overlap on the ${a.wall} wall.`);
    }
  if (s.doors.length === 0) review("doors", "No door has been specified. Every enclosed room needs at least one entry.");

  let blockedArea = 0;
  [...s.columns.map((c) => ({ ...c, kind: "column" })), ...s.obstructions.map((c) => ({ ...c, kind: "obstruction" }))].forEach((b, i) => {
    if (b.x < 0 || b.y < 0 || b.x + b.w > s.length + 1e-6 || b.y + b.d > s.width + 1e-6) err(`${b.kind}s`, `${b.kind} "${b.label || i + 1}" lies outside the room.`);
    if (b.h != null && b.h > s.height + 1e-6) warn(`${b.kind}s`, `${b.kind} "${b.label || i + 1}" is taller than the ceiling.`);
    blockedArea += b.w * b.d;
  });

  const area = s.length * s.width;
  const usable = area - blockedArea;
  if (usable <= 0) err("columns", "Columns and obstructions cover the whole floor.");
  const furnitureArea = s.furniture.reduce((sum, f) => sum + f.w * f.d * f.count, 0);
  s.furniture.forEach((f, i) => {
    const fits = (f.w <= s.length && f.d <= s.width) || (f.d <= s.length && f.w <= s.width);
    if (!fits) err(`furniture.${i}`, `${f.type} (${u(f.w)} x ${u(f.d)}) is larger than the room.`);
    if (f.h > s.height) err(`furniture.${i}`, `${f.type} is taller than the ceiling.`);
  });
  // Circulation: furniture footprint plus a clearance band must fit in the usable area.
  const clearanceArea = s.circulationClearance * (s.length + s.width);
  if (furnitureArea > 0 && furnitureArea + clearanceArea > usable)
    err("furniture", `Required furniture (${furnitureArea.toFixed(1)} m2) plus circulation (${clearanceArea.toFixed(1)} m2) exceeds usable floor area (${usable.toFixed(1)} m2).`);
  else if (furnitureArea > usable * 0.6) warn("furniture", "Furniture covers more than 60% of the floor; the room may feel crowded.");

  if (s.occupancy > 0) {
    const perPerson = usable / s.occupancy;
    const guide = roomType?.spatialProfile.areaPerPersonM2 ?? null;
    if (perPerson < 1.0) err("occupancy", `${s.occupancy} people in ${usable.toFixed(1)} m2 leaves ${perPerson.toFixed(2)} m2 each, which is not physically workable.`);
    else if (guide && perPerson < guide * 0.75)
      review("occupancy", `${perPerson.toFixed(2)} m2 per person is well below the ${guide} m2 guideline for ${roomType!.name}. Please confirm.`);
    const seats = s.furniture.filter((f) => /chair|seat|stool|sofa/i.test(f.type)).reduce((n, f) => n + f.count, 0);
    if (seats > 0 && seats < s.occupancy) review("furniture", `Only ${seats} seats are listed for an occupancy of ${s.occupancy}.`);
  }
  return issues;
}

export const hasErrors = (issues: ValidationIssue[]) => issues.some((i) => i.level === "error");
