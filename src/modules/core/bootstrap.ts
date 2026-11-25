import "server-only";
/**
 * First-run configuration. Everything seeded here is editable in Studio > Admin and is
 * plain starter configuration, not company project data. Demo items are flagged isDemo
 * and labelled in the UI.
 */
import { repo } from "@/modules/persistence";
import { higgsfieldStatus } from "@/modules/higgsfield/config";
import { openaiStatus } from "@/modules/openai/config";
import type { z } from "zod";
import { FloorPlan, type Offering, type RoomType } from "./schemas";
import { now } from "./util";

const ROOM_TYPES: Array<Pick<RoomType, "id" | "name" | "description" | "spatialProfile">> = [
  {
    id: "rt_reception",
    name: "Reception",
    description: "Arrival and waiting area",
    spatialProfile: { minSeats: 0, maxSeats: 12, purposeKeywords: ["reception", "lobby", "waiting", "arrival"], tableArrangements: ["none", "lounge"], areaPerPersonM2: 2.5 },
  },
  {
    id: "rt_meeting",
    name: "Meeting Room",
    description: "Small to medium meeting space",
    spatialProfile: { minSeats: 2, maxSeats: 10, purposeKeywords: ["meeting", "conference", "conference room", "discussion", "huddle"], tableArrangements: ["rectangular", "round", "none"], areaPerPersonM2: 2.0 },
  },
  {
    id: "rt_boardroom",
    name: "Boardroom",
    description: "Formal leadership and board meetings",
    spatialProfile: { minSeats: 10, maxSeats: 30, purposeKeywords: ["boardroom", "board room", "leadership", "directors"], tableArrangements: ["boardroom", "u-shape"], areaPerPersonM2: 2.3 },
  },
  {
    id: "rt_cabin",
    name: "Cabin",
    description: "Private office cabin",
    spatialProfile: { minSeats: 1, maxSeats: 4, purposeKeywords: ["cabin", "director cabin", "private office", "manager cabin"], tableArrangements: ["desk"], areaPerPersonM2: 4.5 },
  },
  {
    id: "rt_workstations",
    name: "Workstation Area",
    description: "Open-plan workstations",
    spatialProfile: { minSeats: 4, maxSeats: 400, purposeKeywords: ["workstation", "open workstations", "open plan", "sales office"], tableArrangements: ["linear desks", "cluster"], areaPerPersonM2: 5.5 },
  },
  {
    id: "rt_pantry",
    name: "Pantry / Cafe",
    description: "Pantry, cafe and breakout",
    spatialProfile: { minSeats: 0, maxSeats: 60, purposeKeywords: ["pantry", "cafe", "cafeteria", "breakout", "kitchen"], tableArrangements: ["cafe tables", "bar counter"], areaPerPersonM2: 1.6 },
  },
  {
    id: "rt_lounge",
    name: "Lounge / Collaboration",
    description: "Lounge, collaboration and breakout seating",
    spatialProfile: { minSeats: 2, maxSeats: 40, purposeKeywords: ["lounge", "collab", "collaboration", "collab area"], tableArrangements: ["lounge", "cluster"], areaPerPersonM2: 2.5 },
  },
  {
    id: "rt_phone_booth",
    name: "Phone Booth",
    description: "Single-person call booth or pod",
    spatialProfile: { minSeats: 1, maxSeats: 2, purposeKeywords: ["phone booth", "booth", "pod", "calling room"], tableArrangements: ["none"], areaPerPersonM2: 1.5 },
  },
  {
    id: "rt_control_room",
    name: "Control Room",
    description: "Control room or command centre",
    spatialProfile: { minSeats: 2, maxSeats: 40, purposeKeywords: ["control room", "command centre", "command center"], tableArrangements: ["linear desks"], areaPerPersonM2: 4 },
  },
  {
    id: "rt_washroom",
    name: "Washroom",
    description: "Washrooms and restrooms",
    spatialProfile: { minSeats: null, maxSeats: null, purposeKeywords: ["washroom", "toilet", "restroom", "gents", "ladies"], tableArrangements: [], areaPerPersonM2: null },
  },
  {
    id: "rt_utility",
    name: "Utility / Service Room",
    description: "Server, UPS, electrical and store rooms",
    spatialProfile: { minSeats: null, maxSeats: null, purposeKeywords: ["server", "server room", "ups room", "electrical", "store room", "storage", "hub room"], tableArrangements: [], areaPerPersonM2: null },
  },
  {
    id: "rt_other",
    name: "Other Space",
    description: "Any space that does not fit another type",
    spatialProfile: { minSeats: null, maxSeats: null, purposeKeywords: [], tableArrangements: [], areaPerPersonM2: null },
  },
  {
    id: "rt_facade",
    name: "Facade / Exterior",
    description: "Building facade and exterior",
    spatialProfile: { minSeats: null, maxSeats: null, purposeKeywords: ["facade", "exterior", "elevation"], tableArrangements: [], areaPerPersonM2: null },
  },
];

const DEMO_OFFERINGS: Array<Pick<Offering, "id" | "name" | "description" | "rank" | "rules">> = [
  {
    id: "off_demo_essential",
    name: "Essential (demo tier)",
    description: "Demo offering. Rename or replace in Studio > Admin > Offerings.",
    rank: 1,
    rules: { mode: "all-approved", roomTypeIds: [], excludedMaterialNames: ["Marble", "Brass"], includeReferenceIds: [], excludeReferenceIds: [], inheritLowerTiers: false, requireApproved: true },
  },
  {
    id: "off_demo_premium",
    name: "Premium (demo tier)",
    description: "Demo offering. Rename or replace in Studio > Admin > Offerings.",
    rank: 2,
    rules: { mode: "all-approved", roomTypeIds: [], excludedMaterialNames: [], includeReferenceIds: [], excludeReferenceIds: [], inheritLowerTiers: true, requireApproved: true },
  },
];

/** SAMPLE geometry. Not a real property survey. Units: metres. */
function sampleFloorPlan(propertyId: string, t: string): FloorPlan {
  return FloorPlan.parse(sampleFloorPlanInput(propertyId, t));
}

function sampleFloorPlanInput(propertyId: string, t: string): z.input<typeof FloorPlan> {
  const rect = (x: number, y: number, w: number, h: number): [number, number][] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  return {
    id: "fp_andheri_sample",
    propertyId,
    name: "Andheri Atlas: Level 1 (SAMPLE LAYOUT)",
    isSample: true,
    sampleNotice: "Sample layout for demonstrating the workflow. It does not represent the real Andheri property.",
    unit: "m",
    width: 32,
    height: 20,
    rooms: [
      { id: "rm_reception", code: "R-01", name: "Reception", roomTypeId: "rt_reception", polygon: rect(0, 0, 8, 7), dimensions: { length: 8, width: 7, height: 3.2 } },
      { id: "rm_meeting_1", code: "M-01", name: "Meeting Room 1", roomTypeId: "rt_meeting", polygon: rect(8, 0, 4, 4), dimensions: { length: 4, width: 4, height: 3 } },
      { id: "rm_meeting_2", code: "M-02", name: "Meeting Room 2", roomTypeId: "rt_meeting", polygon: rect(12, 0, 5, 4), dimensions: { length: 5, width: 4, height: 3 } },
      { id: "rm_boardroom", code: "B-01", name: "Boardroom", roomTypeId: "rt_boardroom", polygon: rect(17, 0, 9, 6), dimensions: { length: 9, width: 6, height: 3.2 } },
      { id: "rm_cabin_1", code: "C-01", name: "Cabin 1", roomTypeId: "rt_cabin", polygon: rect(26, 0, 6, 4), dimensions: { length: 6, width: 4, height: 3 } },
      { id: "rm_cabin_2", code: "C-02", name: "Cabin 2", roomTypeId: "rt_cabin", polygon: rect(26, 4, 6, 4), dimensions: { length: 6, width: 4, height: 3 } },
      { id: "rm_workstations", code: "W-01", name: "Open Workstations", roomTypeId: "rt_workstations", polygon: [[0, 9], [20, 9], [20, 20], [0, 20]], dimensions: { length: 20, width: 11, height: 3.2 } },
      { id: "rm_pantry", code: "P-01", name: "Pantry / Cafe", roomTypeId: "rt_pantry", polygon: rect(22, 10, 10, 10), dimensions: { length: 10, width: 10, height: 3.2 } },
    ],
    createdAt: t,
    updatedAt: t,
  };
}

export const DEFAULT_PROMPT_INSTRUCTIONS = [
  "Preserve the requested room type and its intended use.",
  "Respect the stated room proportions, ceiling height and the positions of doors and windows.",
  "Use the supplied reference images for design language, materials, colours and lighting, in the roles given.",
  "Do not introduce elements that contradict the brief (for example extra windows, different room types or unrelated styles).",
  "Produce a coherent, photorealistic interior concept suitable for a client presentation.",
];

/**
 * Keeps an existing store in step with newer starter room types: adds missing ones and adds new
 * keywords to the starter ones. Never removes or renames anything an admin changed.
 */
/** Starter keywords that turned out to mislead (e.g. "board" matched "MOOD BOARD"). */
const RETIRED_KEYWORDS: Record<string, string[]> = { rt_boardroom: ["board", "formal"], rt_meeting: ["call", "review"] };

async function upgradeRoomTypes() {
  const r = repo();
  const existing = await r.list("roomTypes");
  const t = now();
  for (const [i, rt] of ROOM_TYPES.entries()) {
    const cur = existing.find((e) => e.id === rt.id);
    if (!cur) {
      await r.insert("roomTypes", { ...rt, sortOrder: existing.length + i, createdAt: t, updatedAt: t });
      continue;
    }
    const retired = RETIRED_KEYWORDS[rt.id] ?? [];
    const kept = cur.spatialProfile.purposeKeywords.filter((k) => !retired.includes(k));
    const missing = rt.spatialProfile.purposeKeywords.filter((k) => !kept.includes(k));
    if (missing.length || kept.length !== cur.spatialProfile.purposeKeywords.length)
      await r.update("roomTypes", cur.id, { spatialProfile: { ...cur.spatialProfile, purposeKeywords: [...kept, ...missing] }, updatedAt: t });
  }
}

const done = new WeakMap<object, Promise<void>>();

/** Idempotent per storage backend; safe to call on every request. */
export function ensureBootstrapped() {
  const r = repo();
  const existing = done.get(r);
  if (existing) return existing;
  const p = (async () => {
    await r.exclusive("bootstrap", async () => {
      if (await r.get("settings", "app")) return;
      const t = now();
      for (const [i, rt] of ROOM_TYPES.entries()) await r.insert("roomTypes", { ...rt, sortOrder: i, createdAt: t, updatedAt: t });
      for (const o of DEMO_OFFERINGS) await r.insert("offerings", { ...o, isDemo: true, createdAt: t, updatedAt: t });
      await r.insert("properties", {
        id: "prop_andheri_atlas",
        name: "Andheri Atlas",
        city: "Mumbai",
        address: "Demo property. Replace with real details in Studio > Admin.",
        isDemo: true,
        createdAt: t,
        updatedAt: t,
      });
      await r.insert("floorPlans", sampleFloorPlan("prop_andheri_atlas", t));
      await r.insert("settings", {
        id: "app",
        promptInstructions: DEFAULT_PROMPT_INSTRUCTIONS,
        negativePrompt: "distorted perspective, extra doors, extra windows, people, text, watermark, low quality",
        defaultModelId: openaiStatus().configured && !higgsfieldStatus().configured ? "openai/gpt-image-2.6-sunburst" : "xai/grok-imagine-image-2.0",
        updatedAt: t,
      });
    });
    await r.exclusive("bootstrap-upgrade", upgradeRoomTypes);
  })().catch((e) => {
    done.delete(r);
    throw e;
  });
  done.set(r, p);
  return p;
}
