/**
 * Deterministic Bill of Quantities (BOQ) calculator.
 *
 * Quantities derive strictly from floor-plan polygons or saved RoomSpec dimensions
 * and unit rates stored in `boqItems` — never from AI guesswork.
 */
import type { BoqBasis, BoqCategory, BoqItem, FloorPlanRoom, Offering, RoomSpec, RoomType } from "@/modules/core/schemas";

export const FT_PER_M = 3.2808399;
export const SQFT_PER_SQM = 10.7639104;

export const BOQ_CATEGORY_ORDER: BoqCategory[] = [
  "civil_partitions",
  "flooring",
  "ceiling",
  "wall_finishes",
  "lighting_electrical",
  "furniture",
  "av_hvac_misc",
];

export const BOQ_CATEGORY_LABELS: Record<BoqCategory, string> = {
  civil_partitions: "Partitions & Glazing",
  flooring: "Flooring",
  ceiling: "Ceiling & Acoustics",
  wall_finishes: "Wall Finishes & Panelling",
  lighting_electrical: "Lighting & Electrical",
  furniture: "Furniture & Joinery",
  av_hvac_misc: "HVAC, Data & AV",
};

export const BOQ_BASIS_LABELS: Record<BoqBasis, string> = {
  floor_area_sqft: "Floor Area (sq ft)",
  wall_area_sqft: "Wall Area (sq ft)",
  ceiling_area_sqft: "Ceiling Area (sq ft)",
  seat_count: "Seat Count (seats)",
  room_fixed: "Fixed per Room",
};

export type RoomMetrics = {
  roomId: string;
  code: string;
  name: string;
  roomTypeId: string;
  floorAreaSqm: number;
  floorAreaSqft: number;
  perimeterM: number;
  wallHeightM: number;
  wallAreaSqft: number;
  ceilingAreaSqft: number;
  seatCount: number;
  seatSource: "spec" | "label" | "density" | "none";
};

export type BoqLineItem = {
  itemId: string;
  category: BoqCategory;
  categoryLabel: string;
  name: string;
  specification: string;
  unit: string;
  basis: BoqBasis;
  quantity: number;
  unitRate: number;
  amount: number;
};

export type CategorySubtotal = {
  category: BoqCategory;
  label: string;
  amount: number;
};

export type RoomBoqEstimate = {
  roomId: string;
  roomCode: string;
  roomName: string;
  roomTypeId: string;
  offeringId: string;
  offeringName: string;
  currency: string;
  metrics: RoomMetrics;
  lines: BoqLineItem[];
  byCategory: CategorySubtotal[];
  totalAmount: number;
  costPerSqft: number;
};

export type SessionBoqRoomSummary = {
  roomId: string;
  roomCode: string;
  roomName: string;
  roomTypeId: string;
  selectedOfferingId: string;
  selectedOfferingName: string;
  isChosen: boolean;
  metrics: RoomMetrics;
  selectedBoq: RoomBoqEstimate;
  byOffering: Record<string, RoomBoqEstimate>;
};

export type SessionBoqTierComparison = {
  offeringId: string;
  offeringName: string;
  rank: number;
  totalAmount: number;
  costPerSqft: number;
};

export type SessionBoqSummary = {
  currency: string;
  totalFloorAreaSqft: number;
  totalSeats: number;
  rooms: SessionBoqRoomSummary[];
  selectedTotalAmount: number;
  selectedCostPerSqft: number;
  byCategory: CategorySubtotal[];
  tierComparison: SessionBoqTierComparison[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function polygonAreaRaw(polygon: Array<[number, number]>): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

export function polygonPerimeterRaw(polygon: Array<[number, number]>): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    sum += Math.hypot(x2 - x1, y2 - y1);
  }
  return sum;
}

function inferSeatsFromText(text: string): number | null {
  const m =
    text.match(/(\d+)\s*(?:seater|seats?|pax|persons?|nos?|ws|workstations?)\b/i) ??
    text.match(/\b(?:ws|wk)\s*[-:]?\s*(\d+)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 && n <= 1000 ? n : null;
}

/** Computes physical dimensions and occupant/seat count for a room. */
export function computeRoomMetrics(
  room: FloorPlanRoom,
  planUnit: "m" | "ft",
  roomType?: RoomType | null,
  spec?: RoomSpec | null,
): RoomMetrics {
  let floorAreaSqm = 0;
  let perimeterM = 0;
  let wallHeightM = 3.0;

  if (spec && spec.length > 0 && spec.width > 0) {
    const toM = spec.unit === "ft" ? 1 / FT_PER_M : 1;
    const l = spec.length * toM;
    const w = spec.width * toM;
    floorAreaSqm = l * w;
    perimeterM = 2 * (l + w);
    wallHeightM = spec.height > 0 ? spec.height * toM : 3.0;
  } else {
    const lenFactor = planUnit === "ft" ? 1 / FT_PER_M : 1;
    const areaFactor = planUnit === "ft" ? 1 / SQFT_PER_SQM : 1;
    const polyArea = polygonAreaRaw(room.polygon) * areaFactor;
    const polyPerim = polygonPerimeterRaw(room.polygon) * lenFactor;
    if (polyArea >= 0.01) {
      floorAreaSqm = polyArea;
      perimeterM = polyPerim;
    } else if (room.dimensions) {
      const l = room.dimensions.length * lenFactor;
      const w = room.dimensions.width * lenFactor;
      floorAreaSqm = l * w;
      perimeterM = 2 * (l + w);
    }
    if (room.dimensions?.height) {
      wallHeightM = room.dimensions.height * lenFactor;
    }
  }

  const floorAreaSqft = round2(floorAreaSqm * SQFT_PER_SQM);
  const wallAreaSqft = round2(perimeterM * FT_PER_M * wallHeightM * FT_PER_M);
  const ceilingAreaSqft = floorAreaSqft;

  let seatCount = 0;
  let seatSource: RoomMetrics["seatSource"] = "none";
  if (spec && spec.occupancy > 0) {
    seatCount = spec.occupancy;
    seatSource = "spec";
  } else {
    const parsed = inferSeatsFromText(`${room.labelText ?? ""} ${room.name}`);
    if (parsed !== null) {
      seatCount = parsed;
      seatSource = "label";
    } else if (roomType?.spatialProfile.areaPerPersonM2) {
      const est = Math.round((floorAreaSqm * 0.7) / roomType.spatialProfile.areaPerPersonM2);
      const min = roomType.spatialProfile.minSeats ?? 1;
      const max = roomType.spatialProfile.maxSeats ?? 200;
      seatCount = Math.max(min, Math.min(max, est));
      seatSource = seatCount > 0 ? "density" : "none";
    }
  }

  return {
    roomId: room.id,
    code: room.code,
    name: room.name,
    roomTypeId: room.roomTypeId,
    floorAreaSqm: round2(floorAreaSqm),
    floorAreaSqft,
    perimeterM: round2(perimeterM),
    wallHeightM: round2(wallHeightM),
    wallAreaSqft,
    ceilingAreaSqft,
    seatCount,
    seatSource,
  };
}

function basisQuantity(basis: BoqBasis, m: RoomMetrics): number {
  switch (basis) {
    case "floor_area_sqft":
      return m.floorAreaSqft;
    case "wall_area_sqft":
      return m.wallAreaSqft;
    case "ceiling_area_sqft":
      return m.ceilingAreaSqft;
    case "seat_count":
      return m.seatCount;
    case "room_fixed":
      return 1;
  }
}

/** Computes itemized BOQ and category rollups for a single room under a specific offering tier. */
export function calculateRoomBoq(
  metrics: RoomMetrics,
  offering: Pick<Offering, "id" | "name">,
  allItems: BoqItem[],
  currency = "INR",
): RoomBoqEstimate {
  const applicable = allItems
    .filter((i) => i.offeringId === offering.id && (i.roomTypeIds.length === 0 || i.roomTypeIds.includes(metrics.roomTypeId)))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const lines: BoqLineItem[] = [];
  for (const item of applicable) {
    const qty = round2(basisQuantity(item.basis, metrics) * item.multiplier);
    if (qty <= 0) continue;
    const amount = Math.round(qty * item.unitRate);
    lines.push({
      itemId: item.id,
      category: item.category,
      categoryLabel: BOQ_CATEGORY_LABELS[item.category],
      name: item.name,
      specification: item.specification,
      unit: item.unit,
      basis: item.basis,
      quantity: qty,
      unitRate: item.unitRate,
      amount,
    });
  }

  const categoryTotals = new Map<BoqCategory, number>();
  let totalAmount = 0;
  for (const line of lines) {
    totalAmount += line.amount;
    categoryTotals.set(line.category, (categoryTotals.get(line.category) ?? 0) + line.amount);
  }

  const byCategory: CategorySubtotal[] = BOQ_CATEGORY_ORDER.filter((c) => categoryTotals.has(c)).map((c) => ({
    category: c,
    label: BOQ_CATEGORY_LABELS[c],
    amount: categoryTotals.get(c)!,
  }));

  return {
    roomId: metrics.roomId,
    roomCode: metrics.code,
    roomName: metrics.name,
    roomTypeId: metrics.roomTypeId,
    offeringId: offering.id,
    offeringName: offering.name,
    currency,
    metrics,
    lines,
    byCategory,
    totalAmount,
    costPerSqft: metrics.floorAreaSqft > 0 ? Math.round(totalAmount / metrics.floorAreaSqft) : 0,
  };
}

/** Computes full-floor BOQ summary using each room's chosen offering tier (or the session fallback offering) plus tier-to-tier comparison. */
export function calculateSessionBoq(params: {
  rooms: FloorPlanRoom[];
  planUnit: "m" | "ft";
  roomTypes: RoomType[];
  specsByRoom: Record<string, RoomSpec | null | undefined>;
  selectedOfferingByRoom: Record<string, { offeringId: string; isChosen: boolean } | undefined>;
  defaultOfferingId: string;
  offerings: Offering[];
  boqItems: BoqItem[];
  currency?: string;
}): SessionBoqSummary {
  const currency = params.currency || "INR";
  const sortedOfferings = [...params.offerings].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const offeringMap = new Map(sortedOfferings.map((o) => [o.id, o]));
  const rtMap = new Map(params.roomTypes.map((rt) => [rt.id, rt]));
  const fallbackOffering = offeringMap.get(params.defaultOfferingId) ?? sortedOfferings[0] ?? { id: params.defaultOfferingId, name: params.defaultOfferingId };

  const tierTotals = new Map<string, number>();
  for (const o of sortedOfferings) tierTotals.set(o.id, 0);

  const categoryMap = new Map<BoqCategory, number>();
  let totalFloorAreaSqft = 0;
  let totalSeats = 0;
  let selectedTotalAmount = 0;

  const roomSummaries: SessionBoqRoomSummary[] = params.rooms.map((room) => {
    const metrics = computeRoomMetrics(room, params.planUnit, rtMap.get(room.roomTypeId), params.specsByRoom[room.id]);
    totalFloorAreaSqft += metrics.floorAreaSqft;
    totalSeats += metrics.seatCount;

    const byOffering: Record<string, RoomBoqEstimate> = {};
    for (const o of sortedOfferings) {
      const est = calculateRoomBoq(metrics, o, params.boqItems, currency);
      byOffering[o.id] = est;
      tierTotals.set(o.id, (tierTotals.get(o.id) ?? 0) + est.totalAmount);
    }

    const sel = params.selectedOfferingByRoom[room.id];
    const activeOffering = (sel?.offeringId ? offeringMap.get(sel.offeringId) : undefined) ?? fallbackOffering;
    const selectedBoq = byOffering[activeOffering.id] ?? calculateRoomBoq(metrics, activeOffering, params.boqItems, currency);
    selectedTotalAmount += selectedBoq.totalAmount;

    for (const c of selectedBoq.byCategory) {
      categoryMap.set(c.category, (categoryMap.get(c.category) ?? 0) + c.amount);
    }

    return {
      roomId: room.id,
      roomCode: room.code,
      roomName: room.name,
      roomTypeId: room.roomTypeId,
      selectedOfferingId: activeOffering.id,
      selectedOfferingName: activeOffering.name,
      isChosen: Boolean(sel?.isChosen),
      metrics,
      selectedBoq,
      byOffering,
    };
  });

  const roundedArea = round2(totalFloorAreaSqft);
  const byCategory: CategorySubtotal[] = BOQ_CATEGORY_ORDER.filter((c) => categoryMap.has(c)).map((c) => ({
    category: c,
    label: BOQ_CATEGORY_LABELS[c],
    amount: categoryMap.get(c)!,
  }));

  const tierComparison: SessionBoqTierComparison[] = sortedOfferings.map((o) => {
    const total = tierTotals.get(o.id) ?? 0;
    return {
      offeringId: o.id,
      offeringName: o.name,
      rank: o.rank,
      totalAmount: total,
      costPerSqft: roundedArea > 0 ? Math.round(total / roundedArea) : 0,
    };
  });

  return {
    currency,
    totalFloorAreaSqft: roundedArea,
    totalSeats,
    rooms: roomSummaries,
    selectedTotalAmount,
    selectedCostPerSqft: roundedArea > 0 ? Math.round(selectedTotalAmount / roundedArea) : 0,
    byCategory,
    tierComparison,
  };
}

export function formatMoney(amount: number, currency = "INR"): string {
  const locale = currency === "INR" ? "en-IN" : "en-US";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(Math.round(amount));
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString("en-US")}`;
  }
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Exports the room-by-room selected BOQ lines to RFC-4180 CSV. */
export function boqToCsv(boq: SessionBoqSummary): string {
  const header = ["Room Code", "Room Name", "Area (sq ft)", "Seats", "Selected Tier", "Category", "Item", "Specification", "Basis", "Quantity", "Unit", `Rate (${boq.currency})`, `Amount (${boq.currency})`];
  const rows: string[] = [header.map(csvCell).join(",")];
  for (const r of boq.rooms) {
    if (!r.selectedBoq.lines.length) {
      rows.push([r.roomCode, r.roomName, r.metrics.floorAreaSqft, r.metrics.seatCount, r.selectedOfferingName, "", "No BOQ lines configured", "", "", 0, "", 0, 0].map(csvCell).join(","));
      continue;
    }
    for (const l of r.selectedBoq.lines) {
      rows.push([r.roomCode, r.roomName, r.metrics.floorAreaSqft, r.metrics.seatCount, r.selectedOfferingName, l.categoryLabel, l.name, l.specification, BOQ_BASIS_LABELS[l.basis], l.quantity, l.unit, l.unitRate, l.amount].map(csvCell).join(","));
    }
  }
  rows.push(["TOTAL", "", boq.totalFloorAreaSqft, boq.totalSeats, "", "", "Grand Total", "", "", "", "", "", boq.selectedTotalAmount].map(csvCell).join(","));
  return rows.join("\r\n");
}
