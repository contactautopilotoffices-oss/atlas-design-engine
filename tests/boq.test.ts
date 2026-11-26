import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boqToCsv, calculateRoomBoq, calculateSessionBoq, computeRoomMetrics, formatMoney } from "@/modules/boq/calculator";
import { ensureBootstrapped } from "@/modules/core/bootstrap";
import {
  autoGenerateRoomPreviews,
  cancelFloorPlanPreviewJob,
  cancelSessionGeneration,
  createGeneration,
  generateFloorPlanPreviews,
  getFloorPlanPreviewStatus,
  startFloorPlanPreviewJob,
} from "@/modules/generation/orchestrator";
import { publishPlan } from "@/modules/floorplans/service";
import { roomOptions } from "@/modules/generation/options";
import { OpenAIClient } from "@/modules/openai/client";
import { __setOpenAIClient } from "@/modules/openai/config";
import { repo } from "@/modules/persistence";
import { __resetRateLimits } from "@/modules/security/rate-limit";
import { sessionSummary, startSession, submitChoice } from "@/modules/selections/service";
import { saveRoomSpec } from "@/modules/spatial/service";
import { freshBackends, testPng, useBrowser } from "./helpers/env";
import { LIB, seedLibrary } from "./helpers/scenario";

async function mockOpenAI() {
  const calls: number[] = [];
  const b64 = (await testPng("#f2ede4", "#8a6a45", 800, 600)).toString("base64");
  const fetchImpl = (async () => {
    calls.push(1);
    return new Response(
      JSON.stringify({
        created: Math.floor(Date.now() / 1000),
        data: [{ b64_json: b64 }],
        usage: { input_tokens: 100, output_tokens: 500, total_tokens: 600 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  const client = new OpenAIClient("sk-test-boq", "https://openai.test", fetchImpl, async () => undefined);
  __setOpenAIClient(client);
  process.env.OPENAI_API_KEY = "sk-test-boq";
  return calls;
}

describe("Offerings tiers, deterministic BOQ calculator, and hover tier auto-previews", () => {
  beforeEach(async () => {
    freshBackends();
    __resetRateLimits();
    useBrowser("boq-browser-1");
  });

  afterEach(() => {
    __setOpenAIClient(null);
    process.env.OPENAI_API_KEY = "";
  });

  it("seeds Economy and Premium Economy offerings plus INR starter BOQ items", async () => {
    await ensureBootstrapped();
    const offerings = (await repo().list("offerings")).sort((a, b) => a.rank - b.rank);
    expect(offerings.map((o) => ({ id: o.id, name: o.name }))).toEqual([
      { id: "off_demo_essential", name: "Economy" },
      { id: "off_demo_premium", name: "Premium Economy" },
    ]);
    const boqItems = await repo().list("boqItems");
    expect(boqItems.length).toBe(18);
    const settings = await repo().get("settings", "app");
    expect(settings?.currency).toBe("INR");
  });

  it("computes deterministic room metrics, seat parsing, tiered BOQ totals, and CSV export", async () => {
    await ensureBootstrapped();
    const plan = (await repo().get("floorPlans", "fp_andheri_sample"))!;
    const meeting = plan.rooms.find((r) => r.id === "rm_meeting_1")!;
    const roomTypes = await repo().list("roomTypes");
    const offerings = (await repo().list("offerings")).sort((a, b) => a.rank - b.rank);
    const boqItems = await repo().list("boqItems");

    const labelledMeeting = { ...meeting, labelText: "8 SEATER CONFERENCE ROOM" };
    const m1 = computeRoomMetrics(labelledMeeting, "m", roomTypes.find((r) => r.id === "rt_meeting"), null);
    expect(m1.floorAreaSqm).toBe(16);
    expect(m1.seatCount).toBe(8);
    expect(m1.seatSource).toBe("label");

    const ecoBoq = calculateRoomBoq(m1, offerings[0], boqItems, "INR");
    const peBoq = calculateRoomBoq(m1, offerings[1], boqItems, "INR");
    expect(ecoBoq.totalAmount).toBeGreaterThan(0);
    expect(peBoq.totalAmount).toBeGreaterThan(ecoBoq.totalAmount);
    expect(formatMoney(ecoBoq.totalAmount, "INR")).toContain("₹");

    const sessionBoq = calculateSessionBoq({
      rooms: plan.rooms,
      planUnit: plan.unit,
      roomTypes,
      specsByRoom: {},
      selectedOfferingByRoom: { rm_meeting_1: { offeringId: "off_demo_essential", isChosen: true } },
      defaultOfferingId: "off_demo_premium",
      offerings,
      boqItems,
      currency: "INR",
    });
    expect(sessionBoq.tierComparison).toHaveLength(2);
    expect(sessionBoq.tierComparison[0].totalAmount).toBeLessThan(sessionBoq.tierComparison[1].totalAmount);
    const csv = boqToCsv(sessionBoq);
    expect(csv).toContain("Room Code,Room Name,Area (sq ft)");
    expect(csv).toContain("Economy");
    expect(csv).toContain("Grand Total");
  });

  it("auto-generates categorized tier previews on hover, caches on FloorPlan, and reuses zero-cost across sessions", async () => {
    const { ids } = await seedLibrary(LIB);
    const calls = await mockOpenAI();

    const s1 = await startSession({ propertyId: "prop_andheri_atlas", floorPlanId: "fp_andheri_sample", offeringId: "off_demo_premium" });
    await saveRoomSpec(s1.id, "rm_meeting_1", { unit: "m", length: 5, width: 4, height: 3, roomTypeId: "rt_meeting", occupancy: 8 });

    const auto1 = await autoGenerateRoomPreviews(s1.id, "rm_meeting_1");
    expect(auto1.generatedCount).toBe(2); // Economy, Premium Economy
    expect(auto1.cachedReused).toBe(0);
    expect(calls.length).toBe(2);

    const opts = await roomOptions(s1.id, "rm_meeting_1");
    expect(opts.originalReference?.id).toBeTruthy();
    expect(opts.tiers.map((t) => t.offering.name)).toEqual(["Economy", "Premium Economy"]);
    expect(opts.tiers.every((t) => t.images.length === 1)).toBe(true);

    // Selecting the Economy AI concept updates room selection offeringId to Economy (even in a Premium Economy session)
    const ecoImg = opts.tiers[0].images[0];
    const picked = await submitChoice(s1.id, { roomId: "rm_meeting_1", generatedAssetId: ecoImg.generatedAssetId! });
    expect(picked.selection.offeringId).toBe("off_demo_essential");

    const sum1 = await sessionSummary(s1.id);
    const rmSum1 = sum1.rooms.find((r) => r.room.id === "rm_meeting_1")!;
    expect(rmSum1.selectedBoq.offeringId).toBe("off_demo_essential");
    expect(rmSum1.metrics.seatCount).toBe(8);

    // Second browser opens a fresh session: cached FloorPlan previews reuse at ZERO OpenAI cost
    useBrowser("boq-browser-2");
    const s2 = await startSession({ propertyId: "prop_andheri_atlas", floorPlanId: "fp_andheri_sample", offeringId: "off_demo_premium" });
    const auto2 = await autoGenerateRoomPreviews(s2.id, "rm_meeting_1");
    expect(auto2.generatedCount).toBe(0);
    expect(auto2.cachedReused).toBe(2);
    expect(calls.length).toBe(2);

    // Floor-plan batch generator skips existing cached previews on rm_meeting_1 and creates missing ones for rm_boardroom
    const batch = await generateFloorPlanPreviews("fp_andheri_sample", { kind: "staff", role: "admin", label: "admin", openDevAccess: true }, { roomIds: ["rm_meeting_1", "rm_boardroom"] });
    expect(batch.skippedExisting).toBe(2);
    expect(batch.generated).toBe(2);
    expect(ids.length).toBeGreaterThan(0);
  });

  it("supports stopping in-flight AI generation for both floor-plan pre-render and client sessions", async () => {
    await seedLibrary(LIB);
    const staffActor = { kind: "staff" as const, role: "admin" as const, label: "admin", openDevAccess: true };
    const b64 = (await testPng("#f2ede4", "#8a6a45", 400, 300)).toString("base64");

    // Slow abort-aware mock OpenAI client
    const slowFetch = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(new Response(JSON.stringify({ created: 1, data: [{ b64_json: b64 }] }), { status: 200, headers: { "content-type": "application/json" } }));
        }, 500);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
        });
      })) as typeof fetch;

    __setOpenAIClient(new OpenAIClient("sk-test-stop", "https://openai.test", slowFetch, async () => undefined));
    process.env.OPENAI_API_KEY = "sk-test-stop";

    // 1. Background FloorPlan pre-render start + cancel
    const started = await startFloorPlanPreviewJob("fp_andheri_sample", staffActor);
    expect(started.status).toBe("running");
    const stoppedPlan = await cancelFloorPlanPreviewJob("fp_andheri_sample", staffActor);
    expect(stoppedPlan.cancelled).toBe(true);
    expect(["cancelled", "idle"]).toContain(stoppedPlan.status);
    const liveStatus = await getFloorPlanPreviewStatus("fp_andheri_sample");
    expect(liveStatus.cancelled).toBe(true);

    // 2. Session AI generation abort via cancelSessionGeneration
    const ses = await startSession({ propertyId: "prop_andheri_atlas", floorPlanId: "fp_andheri_sample", offeringId: "off_demo_premium" });
    const genPromise = createGeneration(ses.id, "rm_meeting_1", {
      modelId: "openai/gpt-image-2.6-sunburst",
      alternatives: 1,
      roles: [],
      confirmed: true,
    });
    // Wait briefly so the generation enters slowFetch, then stop it
    await new Promise((r) => setTimeout(r, 80));
    const stopRes = await cancelSessionGeneration(ses.id, { kind: "anonymous" });
    expect(stopRes.stopped).toBe(true);
    const genOut = await genPromise;
    expect(genOut.jobs[0].status).toBe("cancelled");

    // 3. Publish automatically launches background pre-generation on non-sample published plans when OpenAI is configured
    const demoPlan = (await repo().get("floorPlans", "fp_andheri_sample"))!;
    await repo().insert("floorPlans", { ...demoPlan, id: "fp_pub_auto", isSample: false, status: "draft", previews: [] });
    await publishPlan("fp_pub_auto", true, "staff:admin");
    const autoPubStatus = await getFloorPlanPreviewStatus("fp_pub_auto");
    expect(["running", "completed"]).toContain(autoPubStatus.status);
    await cancelFloorPlanPreviewJob("fp_pub_auto", staffActor);
  });
});
