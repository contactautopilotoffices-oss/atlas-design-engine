import { describe, expect, it } from "vitest";
import { RoomSpec, type RoomType } from "@/modules/core/schemas";
import { buildPrompt } from "@/modules/prompt/builder";
import { classifyRoom } from "@/modules/spatial/classify";
import { buildScene } from "@/modules/spatial/scene";
import { validateRoomSpec } from "@/modules/spatial/validate";

const t = new Date().toISOString();
const rt = (id: string, name: string, p: Partial<RoomType["spatialProfile"]>): RoomType => ({
  id, name, description: "", sortOrder: 0, createdAt: t, updatedAt: t,
  spatialProfile: { minSeats: null, maxSeats: null, purposeKeywords: [], tableArrangements: [], areaPerPersonM2: null, ...p },
});
const TYPES = [
  rt("meeting", "Meeting Room", { minSeats: 2, maxSeats: 10, purposeKeywords: ["meeting", "call"], tableArrangements: ["rectangular", "round"], areaPerPersonM2: 2 }),
  rt("board", "Boardroom", { minSeats: 10, maxSeats: 30, purposeKeywords: ["board", "directors"], tableArrangements: ["boardroom"], areaPerPersonM2: 2.3 }),
];
const spec = (p: Partial<RoomSpec> = {}) =>
  RoomSpec.parse({ unit: "m", length: 4, width: 4, height: 3, roomTypeId: null, occupancy: 6, doors: [{ id: "d1", wall: "south", offset: 0.5, width: 1, height: 2.1, sillHeight: 0 }], ...p });

describe("measured scene validation", () => {
  it("accepts a sensible 4 m x 4 m meeting room", () => {
    expect(validateRoomSpec(spec()).filter((i) => i.level === "error")).toEqual([]);
  });
  it("catches impossible measurements and openings", () => {
    const errs = (s: RoomSpec) => validateRoomSpec(s).filter((i) => i.level === "error").map((i) => i.message).join(" | ");
    expect(errs(spec({ length: -2 }))).toMatch(/positive/);
    expect(errs(spec({ height: 1.8 }))).toMatch(/below/);
    expect(errs(spec({ doors: [{ id: "d", wall: "south", offset: 3.5, width: 1, height: 2.1, sillHeight: 0 }] }))).toMatch(/does not fit/);
    expect(errs(spec({ windows: [{ id: "w", wall: "north", offset: 0, width: 1, height: 2.5, sillHeight: 1 }] }))).toMatch(/taller than the ceiling/);
    expect(errs(spec({ windows: [{ id: "w", wall: "south", offset: 0.8, width: 1, height: 1, sillHeight: 0.9 }] }))).toMatch(/overlap/);
    expect(errs(spec({ columns: [{ id: "c", label: "C1", x: 3.8, y: 1, w: 0.5, d: 0.5, h: null }] }))).toMatch(/outside the room/);
    expect(errs(spec({ occupancy: 30 }))).toMatch(/not physically workable/);
    expect(errs(spec({ furniture: [{ id: "f", type: "Table", count: 1, w: 3.9, d: 3.9, h: 0.75 }] }))).toMatch(/exceeds usable floor area/);
  });
  it("flags a missing door for review rather than failing", () => {
    expect(validateRoomSpec(spec({ doors: [] })).some((i) => i.level === "review" && i.field === "doors")).toBe(true);
  });
  it("converts feet correctly", () => {
    const ft = spec({ unit: "ft", length: 13.12, width: 13.12, height: 9.84, doors: [{ id: "d", wall: "south", offset: 1.6, width: 3.3, height: 6.9, sillHeight: 0 }] });
    expect(validateRoomSpec(ft).filter((i) => i.level === "error")).toEqual([]);
    expect(buildScene(ft).length).toBeCloseTo(4, 1);
  });
});

describe("room classification uses several signals, not one size threshold", () => {
  it("same floor area classifies differently depending on purpose, seats and table", () => {
    const meeting = classifyRoom(spec({ length: 7, width: 5, occupancy: 6, intendedUse: "team meeting and video call", tableArrangement: "rectangular" }), TYPES);
    const board = classifyRoom(spec({ length: 7, width: 5, occupancy: 14, intendedUse: "board of directors", tableArrangement: "boardroom" }), TYPES);
    expect(meeting.suggestedRoomTypeId).toBe("meeting");
    expect(board.suggestedRoomTypeId).toBe("board");
  });
  it("a large room with a small meeting purpose is still a meeting room", () => {
    const r = classifyRoom(spec({ length: 12, width: 8, occupancy: 6, intendedUse: "client meeting", tableArrangement: "round" }), TYPES);
    expect(r.suggestedRoomTypeId).toBe("meeting");
  });
  it("flags contradictions between the user's choice and the evidence", () => {
    const r = classifyRoom(spec({ roomTypeId: "board", occupancy: 4, intendedUse: "quick team meeting", tableArrangement: "round" }), TYPES);
    expect(r.contradictions.join(" ")).toMatch(/usually seats at least 10/);
  });
});

describe("deterministic 3D scene", () => {
  it("rebuilds geometry from measurements and cuts real openings", () => {
    const a = buildScene(spec());
    const b = buildScene(spec({ length: 6 }));
    const floorA = a.boxes.find((x) => x.kind === "floor")!;
    const floorB = b.boxes.find((x) => x.kind === "floor")!;
    expect(floorA.size[0]).toBe(4);
    expect(floorB.size[0]).toBe(6);
    const southWalls = a.boxes.filter((x) => x.id.startsWith("wall-south"));
    const total = southWalls.filter((w) => w.size[1] === 3).reduce((s, w) => s + w.size[0], 0);
    expect(total).toBeCloseTo(3); // 4 m wall minus 1 m door
    expect(a.boxes.some((x) => x.kind === "door")).toBe(true);
  });
  it("draws furniture as exactly sized placeholders", () => {
    const s = buildScene(spec({ furniture: [{ id: "t", type: "Meeting table", count: 1, w: 2.4, d: 1.2, h: 0.75 }] }));
    const t = s.boxes.find((x) => x.kind === "furniture")!;
    expect(t.size).toEqual([2.4, 0.75, 1.2]);
    expect(t.placeholder).toBe(true);
  });
});

describe("prompt builder", () => {
  it("includes spatial, design and reference-role sections and numbers images", () => {
    const p = buildPrompt(
      {
        roomTypeName: "Meeting Room", intendedUse: "client meetings", occupancy: 6, designObjective: "calm", designDirection: "Modern Minimal",
        dimensions: { length: 4, width: 4, height: 3, unit: "m" }, doors: ["south wall, 1 m wide"], windows: [], fixedConstraints: [],
        colours: { primary: "#A39A8B", secondary: "#6F573E", tertiary: null }, materials: ["Natural Wood", "Glass"], lighting: ["Warm ambient"], furniture: ["1 x Table"],
        references: [
          { referenceId: "r1", referenceCode: "REF-00001", projectName: "Volt", role: "primary" },
          { referenceId: "r2", referenceCode: "REF-00002", projectName: "B", role: "lighting" },
        ],
      },
      { instructions: ["Preserve the requested room type."], negativePrompt: "text", imageInputs: 2 },
    );
    expect(p.prompt).toContain("4 x 4 m with a 3 m ceiling");
    expect(p.prompt).toContain("Image 1 (REF-00001, project Volt) is the primary design reference");
    expect(p.prompt).toContain("Image 2 (REF-00002, project B) is the lighting reference");
    expect(p.prompt).toContain("Preserve the requested room type.");
    const textOnly = buildPrompt({ ...JSON.parse(JSON.stringify({ roomTypeName: "x", intendedUse: "", occupancy: 0, designObjective: "", designDirection: null, dimensions: { length: 1, width: 1, height: 1, unit: "m" }, doors: [], windows: [], fixedConstraints: [], colours: { primary: null, secondary: null, tertiary: null }, materials: [], lighting: [], furniture: [], references: [{ referenceId: "r", referenceCode: "REF-1", projectName: "P", role: "primary" }] })) }, { instructions: [], negativePrompt: "", imageInputs: 0 });
    expect(textOnly.prompt).toMatch(/does not accept reference images/);
  });
});
