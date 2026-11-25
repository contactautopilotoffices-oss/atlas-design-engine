import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureBootstrapped } from "@/modules/core/bootstrap";
import { refreshJob, __setDownloader } from "@/modules/generation/orchestrator";
import { generateRoomOptions, roomOptions } from "@/modules/generation/options";
import { HiggsfieldClient } from "@/modules/higgsfield/client";
import { __setHiggsfieldClient } from "@/modules/higgsfield/config";
import { quickReview } from "@/modules/intelligence/library";
import { suggestRoomType } from "@/modules/intelligence/suggest";
import { repo } from "@/modules/persistence";
import { __resetRateLimits } from "@/modules/security/rate-limit";
import { sessionSummary, startSession, submitChoice } from "@/modules/selections/service";
import { freshBackends, testPng, useBrowser } from "./helpers/env";
import { LIB, seedLibrary } from "./helpers/scenario";

describe("room type suggestions from page text", () => {
  beforeEach(() => freshBackends());
  it("reads the room names printed on real presentation pages", async () => {
    await ensureBootstrapped();
    const types = await repo().list("roomTypes");
    const s = (text: string, w = 1800, h = 1200) => suggestRoomType({ sourceText: text, width: w, height: h }, types);
    expect(s("14CONFERENCE ROOMProject- VOLT").roomTypeId).toBe("rt_meeting");
    expect(s("10DIRECTOR CABIN- 01Project- VOLT").roomTypeId).toBe("rt_cabin");
    expect(s("21CAFETERIAProject- VOLT").roomTypeId).toBe("rt_pantry");
    expect(s("Project- VOLT 04OPEN WORKSTATIONS AREA").roomTypeId).toBe("rt_workstations");
    expect(s("20PHONE BOOTHProject- VOLT").roomTypeId).toBe("rt_phone_booth");
    expect(s("18COLLAB AREA- 01Project- VOLT").roomTypeId).toBe("rt_lounge");
    expect(s("16CONTROL ROOM / COMMAND CENTREProject- VOLT").roomTypeId).toBe("rt_control_room");
    expect(s("03MOOD BOARDProject- VOLT").roomTypeId).toBeNull();
    expect(s("").roomTypeId).toBeNull();
    expect(s("21CAFETERIA", 221, 236).likelyNotDesign).toBe(true);
  });
});

describe("room options popup flow", () => {
  let ids: string[];
  let sessionId: string;
  beforeEach(async () => {
    freshBackends();
    __resetRateLimits();
    useBrowser("popup");
    ({ ids } = await seedLibrary(LIB));
    sessionId = (await startSession({ propertyId: "prop_andheri_atlas", floorPlanId: "fp_andheri_sample", offeringId: "off_demo_premium" })).id;
    __setDownloader((async () => new Response(new Uint8Array(await testPng("#eeeeee", "#333333")), { headers: { "content-type": "image/png" } })) as typeof fetch);
  });
  afterEach(() => {
    __setHiggsfieldClient(null);
    __setDownloader(null);
  });

  it("one-click review approves with a room type or hides the picture", async () => {
    const [a, b] = ids;
    await repo().update("references", a, { reviewStatus: "pending" });
    await repo().update("references", b, { reviewStatus: "pending" });
    const r = await quickReview([{ id: a, roomTypeId: "rt_cabin" }, { id: b, roomTypeId: null }], "t");
    expect(r).toEqual({ approved: 1, hidden: 1 });
    expect((await repo().get("references", a))!).toMatchObject({ reviewStatus: "approved", metadata: { roomTypeId: "rt_cabin" } });
    expect((await repo().get("references", b))!.reviewStatus).toBe("rejected");
  });

  it("lists library options for the clicked room, then creates 4 AI designs with no measuring step", async () => {
    const opts = await roomOptions(sessionId, "rm_meeting_1");
    expect(opts.library.map((r) => r.id).sort()).toEqual([ids[0], ids[2], ids[3]].sort());
    expect(opts.ai.available).toBe(false); // no Higgsfield key in tests

    const calls: Array<{ url: string; body: unknown }> = [];
    let n = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
      if (url.endsWith("/files/generate-upload-url")) return json({ public_url: `https://cdn.test/${calls.length}.png`, upload_url: "https://s3.test/x", upload_headers: {} });
      if (url.startsWith("https://s3.test")) return new Response(null, { status: 200 });
      if (url.endsWith("/status")) return json({ status: "completed", request_id: "r", images: [{ url: "https://out.test/i.png" }] });
      return json({ status: "queued", request_id: `req-${++n}` });
    }) as typeof fetch;
    __setHiggsfieldClient(new HiggsfieldClient("ID:SECRET", "https://api.test", fetchImpl, async () => undefined));

    await expect(generateRoomOptions(sessionId, "rm_meeting_1", 4, false)).rejects.toThrow();
    const { jobs } = await generateRoomOptions(sessionId, "rm_meeting_1", 4, true);
    expect(jobs).toHaveLength(4);
    const submits = calls.filter((c) => c.url.endsWith("/xai/grok-imagine-image-2.0"));
    expect(submits).toHaveLength(4);
    expect((submits[0].body as { image_urls: string[] }).image_urls).toHaveLength(3); // best 3 library pictures
    expect((submits[0].body as { prompt: string }).prompt).toContain("4 x 4 m"); // floor plan size used
    expect((submits[1].body as { prompt: string }).prompt).toContain("option 2 of 4");

    for (const j of jobs) {
      await repo().update("generationJobs", j.id, { nextPollAt: null });
      await refreshJob(j.id);
    }
    const after = await roomOptions(sessionId, "rm_meeting_1");
    expect(after.generated).toHaveLength(4);
    expect(after.activeJobs).toHaveLength(0);

    // The client picks an AI design: it is saved and stays linked to its source project picture.
    const pick = after.generated[0];
    const { selection } = await submitChoice(sessionId, { roomId: "rm_meeting_1", generatedAssetId: pick.id });
    expect(selection.generatedAssetId).toBe(pick.id);
    expect(ids).toContain(selection.referenceId);
    const sum = await sessionSummary(sessionId);
    expect(sum.rooms.find((r) => r.room.id === "rm_meeting_1")!.selection!.generatedImageUrl).toMatch(/generated-images/);
  });

  it("explains when a room type has no approved pictures to build on", async () => {
    const opts = await roomOptions(sessionId, "rm_pantry");
    expect(opts.library).toHaveLength(0);
    expect(opts.ai.available).toBe(false);
  });
});
