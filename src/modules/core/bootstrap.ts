import "server-only";
/**
 * First-run configuration. Everything seeded here is editable in Studio > Admin and is
 * plain starter configuration, not company project data. Demo items are flagged isDemo
 * and labelled in the UI.
 */
import { blobs, repo } from "@/modules/persistence";
import { higgsfieldStatus } from "@/modules/higgsfield/config";
import { openaiStatus } from "@/modules/openai/config";
import type { z } from "zod";
import type { CollectionName, RecordOf } from "./schemas";
import { BoqItem, FloorPlan, type Offering, type RoomType } from "./schemas";
import { now } from "./util";

async function insertBatch<C extends CollectionName>(r: ReturnType<typeof repo>, c: C, recs: RecordOf<C>[]) {
  if (!recs.length) return;
  if (r.insertMany) await r.insertMany(c, recs);
  else for (const rec of recs) await r.insert(c, rec);
}

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

const DEMO_OFFERINGS: Array<Pick<Offering, "id" | "name" | "description" | "tierGuidance" | "rank" | "rules">> = [
  {
    id: "off_demo_essential",
    name: "Economy",
    description: "Cost-optimised corporate interior fit-out with engineered laminates, modular furniture, mineral-fibre ceiling, and recessed LED lighting.",
    tierGuidance: "Cost-optimised Economy tier: use clean engineered wood laminates, powder-coated frames, loop-pile carpet tiles or vitrified tile flooring, modular 600x600 mineral-fibre grid ceiling, low-VOC matte emulsion walls, and recessed 2x2 LED panel lighting. Avoid exotic marble or brass accents.",
    rank: 1,
    rules: { mode: "all-approved", roomTypeIds: [], excludedMaterialNames: ["Marble", "Brass"], includeReferenceIds: [], excludeReferenceIds: [], inheritLowerTiers: false, requireApproved: true },
  },
  {
    id: "off_demo_premium",
    name: "Premium Economy",
    description: "Balanced upgraded fit-out with wood-veneer and fluted accents, acoustic glazing, cove + linear pendant lighting, and ergonomic seating.",
    tierGuidance: "Upgraded Premium Economy tier: incorporate warm oak veneer or fluted laminate feature walls, tufted patterned carpet tiles, slimline double-glazed acoustic partitions, gypsum cove ceiling with architectural linear LED pendants, and ergonomic modern furniture.",
    rank: 2,
    rules: { mode: "all-approved", roomTypeIds: [], excludedMaterialNames: [], includeReferenceIds: [], excludeReferenceIds: [], inheritLowerTiers: true, requireApproved: true },
  },
];

type StarterBoqSeed = Omit<BoqItem, "createdAt" | "updatedAt">;

function starterBoqItems(t: string): BoqItem[] {
  const tiers: Array<{ id: string; prefix: string; rates: { part: number; floor: number; ceil: number; wall: number; light: number; joinery: number; seat: number; mep: number; av: number }; specs: Record<string, string> }> = [
    {
      id: "off_demo_essential",
      prefix: "eco",
      rates: { part: 420, floor: 160, ceil: 140, wall: 65, light: 180, joinery: 110, seat: 16500, mep: 240, av: 85000 },
      specs: {
        part: "Single-glazed 10mm toughened glass & 75mm gypsum dry-wall partition",
        floor: "Standard loop-pile modular carpet tiles / vitrified tile flooring",
        ceil: "600x600 mineral-fibre acoustic tile grid false ceiling",
        wall: "Low-VOC matte acrylic emulsion paint with standard laminate skirting",
        light: "Recessed 2x2 LED flat panels, DB distribution & modular floor power boxes",
        joinery: "Commercial MR-grade laminate fixed credenza & loose decor allowance",
        seat: "Standard 1200mm modular workstation / ergonomic mesh task chair set",
        mep: "HVAC duct diffusers, sprinkler drops & Cat6 LAN structured cabling",
        av: "65\" 4K commercial wall display with USB tabletop conference speakerphone",
      },
    },
    {
      id: "off_demo_premium",
      prefix: "pe",
      rates: { part: 650, floor: 290, ceil: 235, wall: 155, light: 295, joinery: 220, seat: 28500, mep: 340, av: 185000 },
      specs: {
        part: "Double-glazed slimline acoustic aluminium glass & insulated gypsum partition",
        floor: "Tufted nylon patterned carpet tiles with oak-look LVT circulation plank",
        ceil: "Seamless gypsum board false ceiling with LED perimeter cove & acoustic tiles",
        wall: "Fluted laminate & PET acoustic felt feature panelling with texture paint",
        light: "Suspended architectural linear LED profiles, recessed spots & DALI dimming",
        joinery: "Custom veneer & powder-coated steel credenza, planter boxes & signage",
        seat: "Premium adjustable workstation desk & multi-tilt ergonomic task seating",
        mep: "Linear slot HVAC diffusers, automated lighting sensors & Cat6A structured cabling",
        av: "75\" UHD interactive display with acoustic video-conferencing bar & table box",
      },
    },
  ];
  const rows: StarterBoqSeed[] = [];
  for (const tier of tiers) {
    const items: Array<Omit<StarterBoqSeed, "offeringId" | "isDemo">> = [
      { id: `boq_${tier.prefix}_part`, category: "civil_partitions", name: "Acoustic Partitions & Glazing", specification: tier.specs.part, unit: "sq ft", basis: "wall_area_sqft", multiplier: 0.3, unitRate: tier.rates.part, roomTypeIds: [], sortOrder: 1 },
      { id: `boq_${tier.prefix}_floor`, category: "flooring", name: "Flooring Finishes", specification: tier.specs.floor, unit: "sq ft", basis: "floor_area_sqft", multiplier: 1, unitRate: tier.rates.floor, roomTypeIds: [], sortOrder: 2 },
      { id: `boq_${tier.prefix}_ceil`, category: "ceiling", name: "False Ceiling & Acoustic Grid", specification: tier.specs.ceil, unit: "sq ft", basis: "ceiling_area_sqft", multiplier: 1, unitRate: tier.rates.ceil, roomTypeIds: [], sortOrder: 3 },
      { id: `boq_${tier.prefix}_wall`, category: "wall_finishes", name: "Wall Panelling & Paint", specification: tier.specs.wall, unit: "sq ft", basis: "wall_area_sqft", multiplier: 0.55, unitRate: tier.rates.wall, roomTypeIds: [], sortOrder: 4 },
      { id: `boq_${tier.prefix}_light`, category: "lighting_electrical", name: "Lighting & Electrical Distribution", specification: tier.specs.light, unit: "sq ft", basis: "floor_area_sqft", multiplier: 1, unitRate: tier.rates.light, roomTypeIds: [], sortOrder: 5 },
      { id: `boq_${tier.prefix}_furn_seat`, category: "furniture", name: "Modular Seating & Desking", specification: tier.specs.seat, unit: "seat", basis: "seat_count", multiplier: 1, unitRate: tier.rates.seat, roomTypeIds: [], sortOrder: 6 },
      { id: `boq_${tier.prefix}_furn_join`, category: "furniture", name: "Fixed Joinery & Loose Decor", specification: tier.specs.joinery, unit: "sq ft", basis: "floor_area_sqft", multiplier: 1, unitRate: tier.rates.joinery, roomTypeIds: [], sortOrder: 7 },
      { id: `boq_${tier.prefix}_mep`, category: "av_hvac_misc", name: "HVAC Adaptation, Fire & Data", specification: tier.specs.mep, unit: "sq ft", basis: "floor_area_sqft", multiplier: 1, unitRate: tier.rates.mep, roomTypeIds: [], sortOrder: 8 },
      { id: `boq_${tier.prefix}_av`, category: "av_hvac_misc", name: "Meeting AV & Collaboration Kit", specification: tier.specs.av, unit: "room", basis: "room_fixed", multiplier: 1, unitRate: tier.rates.av, roomTypeIds: ["rt_meeting", "rt_boardroom", "rt_training"], sortOrder: 9 },
    ];
    for (const item of items) rows.push({ ...item, offeringId: tier.id, isDemo: true });
  }
  return rows.map((row) => BoqItem.parse({ ...row, createdAt: t, updatedAt: t }));
}

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
    previews: [],
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

async function upgradeTiersAndBoq() {
  const r = repo();
  const t = now();
  const offerings = await r.list("offerings");
  for (const seed of DEMO_OFFERINGS) {
    const cur = offerings.find((o) => o.id === seed.id);
    if (!cur) {
      await r.insert("offerings", { ...seed, isDemo: true, createdAt: t, updatedAt: t });
      continue;
    }
    const patch: Partial<Offering> = {};
    if ((seed.id === "off_demo_essential" && cur.name === "Essential (demo tier)") || (seed.id === "off_demo_premium" && cur.name === "Premium (demo tier)")) {
      patch.name = seed.name;
      patch.description = seed.description;
    }
    if (!cur.tierGuidance) patch.tierGuidance = seed.tierGuidance;
    if (Object.keys(patch).length) await r.update("offerings", cur.id, { ...patch, updatedAt: t });
  }
  const existingBoq = await r.list("boqItems");
  for (const b of existingBoq) {
    if (b.offeringId === "off_demo_executive") await r.remove("boqItems", b.id);
  }
  const hasExecOffering = offerings.some((o) => o.id === "off_demo_executive");
  if (hasExecOffering) {
    const [sessions, selections, revisions, jobs, assets, plans] = await Promise.all([
      r.list("designSessions"),
      r.list("selections"),
      r.list("selectionRevisions"),
      r.list("generationJobs"),
      r.list("generatedAssets"),
      r.list("floorPlans"),
    ]);
    for (const s of sessions) if (s.offeringId === "off_demo_executive") await r.update("designSessions", s.id, { offeringId: "off_demo_premium", updatedAt: t });
    for (const s of selections) if (s.offeringId === "off_demo_executive") await r.update("selections", s.id, { offeringId: "off_demo_premium" });
    for (const rev of revisions) if (rev.offeringId === "off_demo_executive") await r.update("selectionRevisions", rev.id, { offeringId: "off_demo_premium" });
    for (const j of jobs) if (j.tierOfferingId === "off_demo_executive") await r.update("generationJobs", j.id, { tierOfferingId: "off_demo_premium", updatedAt: t });
    for (const a of assets) if (a.tierOfferingId === "off_demo_executive") await r.update("generatedAssets", a.id, { tierOfferingId: "off_demo_premium", updatedAt: t });
    for (const p of plans) {
      const removed = (p.previews ?? []).filter((pv) => pv.tierOfferingId === "off_demo_executive");
      if (removed.length) {
        for (const pv of removed) await blobs().remove("floor-plans", pv.blobKey).catch(() => undefined);
        await r.update("floorPlans", p.id, {
          previews: (p.previews ?? []).filter((pv) => pv.tierOfferingId !== "off_demo_executive"),
          updatedAt: t,
        });
      }
    }
    await r.remove("offerings", "off_demo_executive");
  }
  const remainingBoq = await r.list("boqItems");
  if (remainingBoq.length === 0) {
    const offeringIds = new Set((await r.list("offerings")).map((o) => o.id));
    for (const item of starterBoqItems(t)) {
      if (offeringIds.has(item.offeringId)) await r.insert("boqItems", item);
    }
  }
  const settings = await r.get("settings", "app");
  if (settings && !settings.currency) await r.update("settings", "app", { currency: "INR", updatedAt: t });
}

const done = new WeakMap<object, Promise<void>>();

/** Idempotent per storage backend; safe to call on every request. */
export function ensureBootstrapped() {
  const r = repo();
  const existing = done.get(r);
  if (existing) return existing;
  const p = (async () => {
    let freshlyCreated = false;
    await r.exclusive("bootstrap", async () => {
      if (await r.get("settings", "app")) return;
      freshlyCreated = true;
      const t = now();
      await insertBatch(r, "roomTypes", ROOM_TYPES.map((rt, i) => ({ ...rt, sortOrder: i, createdAt: t, updatedAt: t })));
      await insertBatch(r, "offerings", DEMO_OFFERINGS.map((o) => ({ ...o, isDemo: true, createdAt: t, updatedAt: t })));
      await insertBatch(r, "boqItems", starterBoqItems(t));
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
        currency: "INR",
        updatedAt: t,
      });
    });
    if (!freshlyCreated) {
      await r.exclusive("bootstrap-upgrade", async () => {
        await upgradeRoomTypes();
        await upgradeTiersAndBoq();
      });
    }
  })().catch((e) => {
    done.delete(r);
    throw e;
  });
  done.set(r, p);
  return p;
}
