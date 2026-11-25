import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyseReference, scanDocumentWithAi } from "@/modules/analysis/scanner";
import { __setVisionFetch, visionStatus } from "@/modules/analysis/vision";
import { ensureBootstrapped } from "@/modules/core/bootstrap";
import { __setPlanFetch } from "@/modules/floorplans/claude";
import { createProject, ingestFile } from "@/modules/ingestion/service";
import { updateReference } from "@/modules/intelligence/library";
import { suggestRoomType } from "@/modules/intelligence/suggest";
import { repo } from "@/modules/persistence";
import { freshBackends, testPng } from "./helpers/env";
import { makePdf } from "./helpers/fixtures";

beforeEach(async () => {
  freshBackends();
  await ensureBootstrapped();
});

afterEach(() => {
  __setVisionFetch(null);
  __setPlanFetch(null);
  process.env.ANTHROPIC_API_KEY = "";
});

describe("Anthropic AI vision analysis and PDF scan", () => {
  it("reports status accurately and stays disabled without ANTHROPIC_API_KEY", () => {
    expect(visionStatus().configured).toBe(false);
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(visionStatus()).toEqual({ configured: true, provider: "anthropic:claude-sonnet-5-5" });
  });

  it("extracts materials, lighting, furniture and imageRole with ai provenance without overwriting human edits", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const p = await createProject({ name: "VOLT", clientName: "", propertyName: "", city: "", category: "" }, "staff:admin");
    const { document } = await ingestFile({ projectId: p.id, filename: "room.png", data: await testPng("#e5ddd0", "#8a6a45"), actor: "staff:admin" });
    const ref = (await repo().list("references", { documentId: document.id }))[0];
    // Simulate a human-edited roomTypeId before AI runs
    await updateReference(ref.id, { metadata: { ...ref.metadata, roomTypeId: "rt_boardroom" } }, "staff:admin");

    __setVisionFetch((async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: "tool_use",
              name: "report_image_analysis",
              input: {
                imageRole: "design_render",
                summary: "Modern boardroom with timber table and linear pendant lights.",
                roomTypeId: "rt_meeting",
                designLanguage: "Modern Vibrant",
                visualCharacteristics: ["Warm wood", "Acoustic panels"],
                materials: { flooring: ["Graphic Carpet"], walls: ["Acoustic Panel (Blue)"], ceiling: ["Acoustic Grid"], furniture: ["Wood Finish"], surfaces: ["Frosted Glass"], other: [] },
                lighting: { natural: "Side glazing", artificial: "Linear LED pendant", ambient: "Cove lighting", accent: null, temperatureK: 3500 },
                furniture: { types: ["Conference Table", "Task Chairs"], arrangement: "Central table", partitions: "Glazed", doorsWindows: "Full-height glass", composition: null, distinctiveElements: [] },
                classification: { designCategory: "Executive", tags: ["modern", "timber"], keywords: ["boardroom"] },
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch);

    const res = await analyseReference(ref.id, "staff:admin");
    expect(res.status).toBe("completed");
    expect(res.reference.reviewStatus).toBe("pending"); // never auto-approved
    expect(res.reference.analysis.imageRole).toBe("design_render");
    expect(res.reference.metadata.roomTypeId).toBe("rt_boardroom"); // human edit preserved!
    expect(res.reference.provenance["roomTypeId"]).toBe("human");
    expect(res.reference.metadata.materials.flooring).toEqual(["Graphic Carpet"]);
    expect(res.reference.provenance["materials.flooring"]).toBe("ai");
    expect(res.reference.provenance["colors.primary"]).toBe("observed");
  });

  it("flags key_plan and mood_board images as non-design in suggestions even when large", async () => {
    const types = await repo().list("roomTypes");
    const nonDesign = suggestRoomType(
      { sourceText: "CONFERENCE ROOM", width: 1400, height: 900, analysis: { imageRole: "key_plan" } },
      types,
    );
    expect(nonDesign.likelyNotDesign).toBe(true);
    expect(nonDesign.roomTypeId).toBeNull();

    const aiSuggested = suggestRoomType(
      { sourceText: "", width: 1400, height: 900, metadata: { roomTypeId: "rt_pantry" }, provenance: { roomTypeId: "ai" }, analysis: { imageRole: "design_render" } },
      types,
    );
    expect(aiSuggested).toEqual({ roomTypeId: "rt_pantry", matched: "AI vision analysis", likelyNotDesign: false });
  });

  it("scans a PDF overview, creates a draft 2D floor plan, and analyses extracted images", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const p = await createProject({ name: "VOLT Deck", clientName: "Volt", propertyName: "", city: "", category: "" }, "staff:admin");
    const pdfBytes = await makePdf();
    const { document } = await ingestFile({ projectId: p.id, filename: "volt.pdf", data: pdfBytes, actor: "staff:admin" });

    __setVisionFetch((async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { tools: Array<{ name: string }> };
      if (body.tools[0].name === "report_pdf_overview") {
        return new Response(
          JSON.stringify({
            content: [
              {
                type: "tool_use",
                name: "report_pdf_overview",
                input: {
                  projectDetails: { projectName: "VOLT", location: "Skymark Noida", date: "21 Aug 2026", presentedBy: "Autopilot" },
                  moodBoard: { page: 3, styleSummary: "Modern vibrant workspace", colorPalette: [{ name: "Warm Orange", hex: "#E58A35" }], materialPalette: ["Acoustic Panel (Blue)", "Wood Finish"] },
                  layoutPage: 2,
                  layoutLegend: [{ name: "Workstations", capacity: "4' x 2' WS", count: 48 }, { name: "Conference Room", capacity: "18 PAX", count: 1 }],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "tool_use",
              name: "report_image_analysis",
              input: {
                imageRole: "design_render",
                summary: "Open workstation area with orange acoustic screens.",
                roomTypeId: "rt_workstations",
                designLanguage: "Modern Vibrant",
                materials: { flooring: ["Carpet"], walls: [], ceiling: [], furniture: ["Wood Finish"], surfaces: [], other: [] },
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch);

    __setPlanFetch((async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: "tool_use",
              name: "report_rooms",
              input: {
                rooms: [
                  { name: "Conference Room (18 Pax)", label_text: "18 SEATER CONFERENCE ROOM", x1: 100, y1: 100, x2: 400, y2: 300, confidence: "high" },
                  { name: "Open Workstations", label_text: "WORKSTATION 48 NOS", x1: 500, y1: 200, x2: 900, y2: 600, confidence: "high" },
                ],
                scale: { metres_per_pixel: 0.03, reasoning: "Workstations" },
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch);

    const out = await scanDocumentWithAi(document.id, "staff:admin", { createFloorPlan: true, analyseImages: true });
    expect(out.scanned).toBe(true);
    expect(out.pdfScan?.layoutLegend).toHaveLength(2);
    expect(out.pdfScan?.moodBoard?.materialPalette).toEqual(["Acoustic Panel (Blue)", "Wood Finish"]);
    expect(out.pdfScan?.floorPlanId).toBeTruthy();

    const plan = (await repo().get("floorPlans", out.pdfScan!.floorPlanId!))!;
    expect(plan.status).toBe("draft");
    expect(plan.rooms).toHaveLength(2);

    expect(out.analysis.completed).toBe(3);
    const refs = await repo().list("references", { documentId: document.id });
    expect(refs.every((r) => r.analysis.status === "completed")).toBe(true);
  });
});
