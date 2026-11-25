/**
 * Deterministic scene model built only from the measured RoomSpec. The 3D viewer renders
 * exactly these boxes; nothing is guessed by an AI model. Coordinates: metres, x along
 * length (west->east), z along width (north->south), y up. Origin at the north-west floor corner.
 */
import type { RoomSpec, Wall } from "@/modules/core/schemas";
import { toMetres, wallLength } from "./validate";

export type SceneBox = {
  id: string;
  kind: "floor" | "ceiling" | "wall" | "door" | "window" | "column" | "obstruction" | "furniture";
  label: string;
  /** centre position */
  position: [number, number, number];
  size: [number, number, number];
  placeholder?: boolean;
};

export type SceneModel = { length: number; width: number; height: number; boxes: SceneBox[]; furnitureUnplaced: string[] };

const T = 0.12; // wall thickness used for drawing only

/** Converts a position along a wall into world x/z. */
function along(s: { length: number; width: number }, wall: Wall, offset: number, width: number) {
  const c = offset + width / 2;
  switch (wall) {
    case "north":
      return { x: c, z: 0, horizontal: true };
    case "south":
      return { x: c, z: s.width, horizontal: true };
    case "west":
      return { x: 0, z: c, horizontal: false };
    case "east":
      return { x: s.length, z: c, horizontal: false };
  }
}

export function buildScene(input: RoomSpec): SceneModel {
  const s = toMetres(input);
  const boxes: SceneBox[] = [];
  const { length: L, width: W, height: H } = s;
  boxes.push({ id: "floor", kind: "floor", label: "Floor", position: [L / 2, -0.01, W / 2], size: [L, 0.02, W] });
  boxes.push({ id: "ceiling", kind: "ceiling", label: "Ceiling", position: [L / 2, H + 0.01, W / 2], size: [L, 0.02, W] });

  // Walls are split into solid segments around openings so openings are real gaps.
  for (const wall of ["north", "south", "east", "west"] as Wall[]) {
    const wl = wallLength(s, wall);
    const openings = [...s.doors.map((o) => ({ ...o, k: "door" as const })), ...s.windows.map((o) => ({ ...o, k: "window" as const }))]
      .filter((o) => o.wall === wall)
      .sort((a, b) => a.offset - b.offset);
    const pieces: Array<{ from: number; to: number; y0: number; y1: number }> = [];
    let cursor = 0;
    for (const o of openings) {
      const from = Math.max(0, o.offset);
      const to = Math.min(wl, o.offset + o.width);
      if (from > cursor) pieces.push({ from: cursor, to: from, y0: 0, y1: H });
      if (o.sillHeight > 0) pieces.push({ from, to, y0: 0, y1: Math.min(H, o.sillHeight) });
      if (o.sillHeight + o.height < H) pieces.push({ from, to, y0: o.sillHeight + o.height, y1: H });
      cursor = Math.max(cursor, to);
    }
    if (cursor < wl) pieces.push({ from: cursor, to: wl, y0: 0, y1: H });
    pieces.forEach((p, i) => {
      const len = p.to - p.from;
      const h = p.y1 - p.y0;
      if (len <= 0 || h <= 0) return;
      const a = along(s, wall, p.from, len);
      boxes.push({
        id: `wall-${wall}-${i}`,
        kind: "wall",
        label: `${wall} wall`,
        position: [a.x, p.y0 + h / 2, a.z],
        size: a.horizontal ? [len, h, T] : [T, h, len],
      });
    });
    openings.forEach((o, i) => {
      const a = along(s, wall, o.offset, o.width);
      boxes.push({
        id: `${o.k}-${wall}-${i}`,
        kind: o.k,
        label: `${o.k === "door" ? "Door" : "Window"} ${o.width.toFixed(2)} x ${o.height.toFixed(2)} m`,
        position: [a.x, o.sillHeight + o.height / 2, a.z],
        size: a.horizontal ? [o.width, o.height, T / 3] : [T / 3, o.height, o.width],
      });
    });
  }

  for (const [kind, list] of [["column", s.columns], ["obstruction", s.obstructions]] as const)
    list.forEach((b, i) => {
      const h = b.h ?? H;
      boxes.push({ id: `${kind}-${i}`, kind, label: b.label || `${kind} ${i + 1}`, position: [b.x + b.w / 2, h / 2, b.y + b.d / 2], size: [b.w, h, b.d] });
    });

  // Furniture placeholders: accurately sized boxes placed on a simple shelf-packing grid
  // inside the clearance margin. Placement is indicative; sizes are exact.
  const margin = Math.min(s.circulationClearance, Math.min(L, W) / 4);
  let x = margin;
  let z = margin;
  let rowDepth = 0;
  const unplaced: string[] = [];
  const blocked = [...s.columns, ...s.obstructions];
  const collides = (bx: number, bz: number, w: number, d: number) => blocked.some((b) => bx < b.x + b.w && b.x < bx + w && bz < b.y + b.d && b.y < bz + d);
  const items = s.furniture.flatMap((f) => Array.from({ length: f.count }, (_, n) => ({ ...f, n }))).sort((a, b) => b.w * b.d - a.w * a.d);
  for (const f of items) {
    let placed = false;
    for (let guard = 0; guard < 400 && !placed; guard++) {
      if (x + f.w > L - margin) {
        x = margin;
        z += rowDepth + 0.3;
        rowDepth = 0;
      }
      if (z + f.d > W - margin) break;
      if (!collides(x, z, f.w, f.d)) {
        boxes.push({ id: `furn-${f.id}-${f.n}`, kind: "furniture", label: `${f.type} (placeholder)`, position: [x + f.w / 2, f.h / 2, z + f.d / 2], size: [f.w, f.h, f.d], placeholder: true });
        x += f.w + 0.3;
        rowDepth = Math.max(rowDepth, f.d);
        placed = true;
      } else x += 0.25;
    }
    if (!placed) unplaced.push(f.type);
  }
  return { length: L, width: W, height: H, boxes, furnitureUnplaced: unplaced };
}
