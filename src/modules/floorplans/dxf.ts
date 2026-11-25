/**
 * Reads rooms straight out of a DXF drawing, with no AI:
 * closed polylines are room outlines, and the text written inside an outline is its name.
 * Sizes come from the drawing's own units, so they are exact.
 */
import DxfParser from "dxf-parser";
import { AppError } from "@/modules/core/util";

type Pt = [number, number];
export type DxfRoom = { name: string; labelText: string; polygon: Pt[] };
export type DxfReading = {
  rooms: DxfRoom[];
  width: number;
  height: number;
  /** True when the file said what its units are. False means we guessed from the drawing size. */
  unitsKnown: boolean;
  unitsNote: string;
  outlinesFound: number;
  unlabelledOutlines: number;
};

// $INSUNITS codes to metres. https://help.autodesk.com/view/OARX/2024/ENU/?guid=GUID-A58A87BB-482B-4042-A00A-EEF55A2B4FD8
const UNIT_TO_M: Record<number, [number, string]> = {
  1: [0.0254, "inches"],
  2: [0.3048, "feet"],
  4: [0.001, "millimetres"],
  5: [0.01, "centimetres"],
  6: [1, "metres"],
};

/** Labels that mark circulation or services rather than a room a client designs. */
const NOT_A_ROOM = /\b(passage|corridor|lobby lift|lift|elevator|stair|staircase|shaft|duct|void|atrium|ramp|fire exit|entry|entrance)\b/i;

export function cleanMtext(s: string) {
  return s
    .replace(/\\P/g, " ")
    .replace(/\\[A-Za-z][^;\\{}]*;/g, "")
    .replace(/\\[~\\{}]/g, (m) => m.slice(1))
    .replace(/[{}]/g, "")
    .replace(/%%[cdpCDP]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function area(poly: Pt[]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function inside([x, y]: Pt, poly: Pt[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

type Entity = {
  type: string;
  shape?: boolean;
  closed?: boolean;
  vertices?: Array<{ x: number; y: number }>;
  text?: string;
  startPoint?: { x: number; y: number };
  position?: { x: number; y: number };
};

export function readDxf(text: string): DxfReading {
  let parsed: { header?: Record<string, unknown>; entities?: Entity[] } | null;
  try {
    parsed = new DxfParser().parseSync(text) as typeof parsed;
  } catch {
    throw new AppError("This DXF file could not be read. In AutoCAD use File > Save As and choose an AutoCAD DXF format.", 422, "bad_dxf");
  }
  const entities = parsed?.entities ?? [];

  const outlines: Pt[][] = [];
  const labels: Array<{ at: Pt; text: string }> = [];
  for (const e of entities) {
    if ((e.type === "LWPOLYLINE" || e.type === "POLYLINE") && (e.shape || e.closed) && (e.vertices?.length ?? 0) >= 3) {
      outlines.push(e.vertices!.map((v) => [v.x, v.y] as Pt));
    } else if (e.type === "TEXT" || e.type === "MTEXT") {
      const at = e.type === "TEXT" ? (e.startPoint ?? e.position) : (e.position ?? e.startPoint);
      const t = cleanMtext(e.text ?? "");
      if (at && t) labels.push({ at: [at.x, at.y], text: t });
    }
  }
  if (!outlines.length) throw new AppError("No closed room outlines were found in this DXF. Rooms need to be drawn as closed polylines.", 422, "no_rooms");

  // Units: trust the file when it says, otherwise guess from the overall size of the drawing.
  const xs = outlines.flat().map((p) => p[0]);
  const ys = outlines.flat().map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const extent = Math.max(maxX - minX, maxY - minY);
  const code = Number(parsed?.header?.["$INSUNITS"] ?? 0);
  let toM: number;
  let unitsKnown = true;
  let unitsNote: string;
  if (UNIT_TO_M[code]) {
    [toM, unitsNote] = [UNIT_TO_M[code][0], `Drawing units: ${UNIT_TO_M[code][1]}.`];
  } else {
    unitsKnown = false;
    if (extent > 3000) [toM, unitsNote] = [0.001, "The file does not say its units. It looks like millimetres. Please check the size."];
    else if (extent > 300) [toM, unitsNote] = [0.0254, "The file does not say its units. It looks like inches. Please check the size."];
    else [toM, unitsNote] = [1, "The file does not say its units. It looks like metres. Please check the size."];
  }

  // Each label belongs to the smallest outline it sits in, so a desk label never names the whole floor.
  const areas = outlines.map(area);
  const owned = new Map<number, string[]>();
  for (const l of labels) {
    let best = -1;
    outlines.forEach((o, i) => {
      if (inside(l.at, o) && (best === -1 || areas[i] < areas[best])) best = i;
    });
    if (best >= 0) owned.set(best, [...(owned.get(best) ?? []), l.text]);
  }

  const rooms: DxfRoom[] = [];
  for (const [i, texts] of owned) {
    const m2 = areas[i] * toM * toM;
    if (m2 < 1 || m2 > 5000) continue;
    const labelText = texts.join(" / ");
    const name = texts.find((t) => /[a-z]{3,}/i.test(t)) ?? texts[0];
    if (NOT_A_ROOM.test(labelText) && !/\b(room|cabin|booth|area|pantry|cafe)\b/i.test(labelText)) continue;
    rooms.push({
      name: name.replace(/\s+/g, " ").trim().slice(0, 80),
      labelText,
      // DXF y points up; screens draw y down. Shift to start at 0,0 and convert to metres.
      polygon: outlines[i].map(([x, y]) => [round((x - minX) * toM), round((maxY - y) * toM)] as Pt),
    });
  }
  // Reading order: top to bottom, then left to right.
  const corner = (r: DxfRoom) => [Math.min(...r.polygon.map((p) => p[1])), Math.min(...r.polygon.map((p) => p[0]))];
  rooms.sort((a, b) => corner(a)[0] - corner(b)[0] || corner(a)[1] - corner(b)[1]);
  return {
    rooms,
    width: round((maxX - minX) * toM),
    height: round((maxY - minY) * toM),
    unitsKnown,
    unitsNote,
    outlinesFound: outlines.length,
    unlabelledOutlines: outlines.length - owned.size,
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
