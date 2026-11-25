import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureBootstrapped } from "@/modules/core/bootstrap";
import { __setPlanFetch } from "@/modules/floorplans/claude";
import { cleanMtext, readDxf } from "@/modules/floorplans/dxf";
import { detectPlanKind, importPlan, publishPlan, updatePlan } from "@/modules/floorplans/service";
import { guessPlanPage } from "@/modules/floorplans/source";
import { blobs, repo } from "@/modules/persistence";
import { startSession } from "@/modules/selections/service";
import { freshBackends, testPng } from "./helpers/env";

// ---------- a small DXF written by hand (TEST FIXTURE, not a real drawing). Units: millimetres.
const poly = (pts: Array<[number, number]>) =>
  ["0", "LWPOLYLINE", "8", "WALLS", "90", String(pts.length), "70", "1", ...pts.flatMap(([x, y]) => ["10", String(x), "20", String(y)])];
const text = (x: number, y: number, t: string) => ["0", "TEXT", "8", "TEXT", "10", String(x), "20", String(y), "30", "0", "40", "250", "1", t];
const mtext = (x: number, y: number, t: string) => ["0", "MTEXT", "8", "TEXT", "10", String(x), "20", String(y), "30", "0", "40", "250", "1", t];
function dxf(units: number | null) {
  return [
    "0", "SECTION", "2", "HEADER",
    ...(units ? ["9", "$INSUNITS", "70", String(units)] : []),
    "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES",
    ...poly([[0, 0], [30000, 0], [30000, 20000], [0, 20000]]), // outer wall, no label of its own
    ...poly([[0, 14000], [6000, 14000], [6000, 20000], [0, 20000]]), // conference room, top-left
    ...text(1500, 17000, "CONFERENCE ROOM"),
    ...poly([[24000, 17000], [27000, 17000], [27000, 20000], [24000, 20000]]), // cabin
    ...mtext(24500, 18500, "{\\fArial|b1;DIRECTOR}\\PCABIN 01"),
    ...poly([[0, 10000], [30000, 10000], [30000, 11500], [0, 11500]]), // passage
    ...text(12000, 10700, "4'0\" WIDE PASSAGE"),
    ...poly([[10000, 3000], [11200, 3000], [11200, 3600], [10000, 3600]]), // a desk, no label
    "0", "ENDSEC", "0", "EOF",
  ].join("\n");
}

describe("DXF floor plans are read without AI", () => {
  it("finds labelled rooms with exact sizes and skips passages and furniture", () => {
    const d = readDxf(dxf(4));
    expect(d.unitsKnown).toBe(true);
    expect([d.width, d.height]).toEqual([30, 20]);
    expect(d.rooms.map((r) => r.name)).toEqual(["CONFERENCE ROOM", "DIRECTOR CABIN 01"]);
    // y is flipped so the top of the drawing is y = 0 on screen
    expect(d.rooms[0].polygon).toContainEqual([0, 0]);
    expect(d.rooms[0].polygon).toContainEqual([6, 6]);
    expect(d.unlabelledOutlines).toBe(2); // outer wall and the desk
  });
  it("guesses units when the file does not say, and says it guessed", () => {
    const d = readDxf(dxf(null));
    expect(d.unitsKnown).toBe(false);
    expect(d.width).toBe(30);
    expect(d.unitsNote).toMatch(/millimetres/);
  });
  it("cleans AutoCAD MTEXT formatting", () => {
    expect(cleanMtext("{\\fArial|b1;MEETING}\\PROOM 02")).toBe("MEETING ROOM 02");
  });
});

describe("plan file checks", () => {
  it("explains what to do with a DWG", () => {
    expect(() => detectPlanKind("plan.dwg", Buffer.from("AC1032 binary"))).toThrow(/Save As/);
  });
  it("picks the layout page of a deck", () => {
    expect(guessPlanPage([{ page: 1, text: "DESIGN PRESENTATION" }, { page: 2, text: "LEGEND: Project- VOLT PROPOSED LAYOUT 02" }, { page: 3, text: "MOOD BOARD" }])).toBe(2);
  });
});

describe("importing and publishing a plan", () => {
  beforeEach(async () => {
    freshBackends();
    await ensureBootstrapped();
  });
  afterEach(() => {
    __setPlanFetch(null);
    process.env.ANTHROPIC_API_KEY = "";
  });

  it("DXF: draft with exact room sizes, then published and opened by a client", async () => {
    const { plan } = await importPlan({ fileName: "volt.dxf", data: Buffer.from(dxf(4)), newPropertyName: "Volt Sky Mark", city: "Noida", actor: "t" });
    expect(plan).toMatchObject({ status: "draft", scale: { method: "drawing" }, source: { kind: "dxf" } });
    expect(plan.rooms.find((r) => r.name === "CONFERENCE ROOM")).toMatchObject({ roomTypeId: "rt_meeting", dimensions: { length: 6, width: 6 } });
    expect(plan.rooms.find((r) => r.name === "DIRECTOR CABIN 01")!.roomTypeId).toBe("rt_cabin");
    const property = (await repo().get("properties", plan.propertyId))!;
    expect(property).toMatchObject({ name: "Volt Sky Mark", city: "Noida", isDemo: false });

    const offeringId = (await repo().list("offerings"))[0].id;
    await expect(startSession({ propertyId: property.id, floorPlanId: plan.id, offeringId })).rejects.toThrow(/still being checked/);
    await publishPlan(plan.id, true, "t");
    const s = await startSession({ propertyId: property.id, floorPlanId: plan.id, offeringId });
    expect(s.floorPlanId).toBe(plan.id);
  });

  it("PDF/image: Claude reads the rooms, the size stays a guess until a person confirms it", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    const calls: Array<{ headers: Record<string, string>; body: { model: string; messages: Array<{ content: Array<{ type: string; source?: { data: string } }> }> } }> = [];
    __setPlanFetch((async (_url: string, init: RequestInit) => {
      calls.push({ headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "tool_use",
              name: "report_rooms",
              input: {
                rooms: [
                  { name: "Conference Room (18 Pax)", label_text: "18 SEATER CONFERENCE ROOM", x1: 100, y1: 100, x2: 400, y2: 300, confidence: "high" },
                  { name: "Director Cabin 1", label_text: "DIRECTOR CABIN-01", x1: 1300, y1: 100, x2: 1500, y2: 250, confidence: "high" },
                  { name: "Meeting Room", label_text: "", x1: 600, y1: 700, x2: 750, y2: 850, confidence: "low" },
                ],
                scale: { metres_per_pixel: 0.025, reasoning: "Workstation 4'0\" is 49 px" },
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch);

    const png = await testPng("#ffffff", "#222222", 2000, 1000);
    const { plan } = await importPlan({ fileName: "layout.png", data: png, newPropertyName: "Volt", actor: "t" });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers["x-api-key"]).toBe("test-key-not-real");
    // sent no larger than 1568 px; coordinates are in that picture's pixels
    expect(plan.width).toBeCloseTo(1568 * 0.025, 1);
    expect(plan.background).toMatchObject({ pixelWidth: 2000, pixelHeight: 1000 });
    expect(await blobs().get("floor-plans", plan.background!.key)).not.toBeNull();
    expect(plan.scale!.method).toBe("ai_estimate");
    expect(plan.rooms.every((r) => r.dimensions === null)).toBe(true); // no sizes from a guess
    expect(plan.rooms.map((r) => r.roomTypeId)).toEqual(["rt_meeting", "rt_cabin", "rt_meeting"]);
    expect(plan.rooms[2].confidence).toBe("low");

    await expect(publishPlan(plan.id, true, "t")).rejects.toThrow(/size/);
    const fixed = await updatePlan(plan.id, { realWidthMetres: 40 }, "t");
    expect(fixed.width).toBe(40);
    expect(fixed.scale!.method).toBe("confirmed");
    const conf = fixed.rooms[0];
    expect(conf.dimensions).toMatchObject({ length: expect.closeTo((300 * 0.025 * 40) / plan.width, 1) });
    expect((await publishPlan(plan.id, true, "t")).status).toBe("published");
  });

  it("a rejected key gives a clear message and never echoes the key", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-secret-value";
    __setPlanFetch((async () => new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 })) as typeof fetch);
    const err = await importPlan({ fileName: "p.png", data: await testPng("#fff", "#000", 900, 600), newPropertyName: "X", actor: "t" }).catch((e: Error) => e);
    expect(String((err as Error).message)).toMatch(/rejected/);
    expect(String((err as Error).message)).not.toContain("sk-ant-secret-value");
    expect(await repo().list("properties")).not.toContainEqual(expect.objectContaining({ name: "X" }));
  });

  it("plans saved before drafts existed (no status) still open for clients", async () => {
    const sample = (await repo().get("floorPlans", "fp_andheri_sample"))!;
    const legacy: Partial<typeof sample> = { ...sample };
    delete legacy.status;
    await repo().remove("floorPlans", sample.id);
    await repo().insert("floorPlans", legacy as typeof sample);
    const offeringId = (await repo().list("offerings"))[0].id;
    expect((await startSession({ propertyId: sample.propertyId, floorPlanId: sample.id, offeringId })).floorPlanId).toBe(sample.id);
  });

  it("edits keep room ids so existing client choices stay attached", async () => {
    const { plan } = await importPlan({ fileName: "v.dxf", data: Buffer.from(dxf(4)), newPropertyName: "V", actor: "t" });
    const rooms = plan.rooms.map((r) => ({ id: r.id, name: r.name, roomTypeId: r.roomTypeId, polygon: r.polygon }));
    rooms[0].name = "Boardroom";
    rooms.push({ id: undefined as unknown as string, name: "Pantry", roomTypeId: "rt_pantry", polygon: [[10, 0], [14, 0], [14, 4], [10, 4]] });
    const u = await updatePlan(plan.id, { rooms }, "t");
    expect(u.rooms[0]).toMatchObject({ id: plan.rooms[0].id, name: "Boardroom" });
    expect(u.rooms[2]).toMatchObject({ name: "Pantry", dimensions: { length: 4, width: 4 } });
  });
});
