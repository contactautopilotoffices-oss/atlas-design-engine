import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGeneration, cancelJob, previewBrief, refreshJob, __setDownloader } from "@/modules/generation/orchestrator";
import { HiggsfieldClient } from "@/modules/higgsfield/client";
import { __setHiggsfieldClient, higgsfieldCredential } from "@/modules/higgsfield/config";
import { buildRequestBody, getModel } from "@/modules/higgsfield/models";
import { repo, blobs } from "@/modules/persistence";
import { recordReview } from "@/modules/review/service";
import { __resetRateLimits } from "@/modules/security/rate-limit";
import { startSession, submitChoice } from "@/modules/selections/service";
import { saveRoomSpec } from "@/modules/spatial/service";
import { freshBackends, testPng, useBrowser } from "./helpers/env";
import { LIB, seedLibrary } from "./helpers/scenario";

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };

/** A fake Higgsfield API implementing the documented endpoints. No network, no credits. */
function fakeApi(opts: { statusSequence?: string[]; failSubmit?: number; rateLimitOnce?: boolean } = {}) {
  const calls: Call[] = [];
  let polled = 0;
  let rateLimited = false;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}));
    const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : init?.body ? "<binary>" : undefined;
    calls.push({ method: init?.method ?? "GET", url, headers, body });
    const json = (o: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...h } });
    if (url.endsWith("/files/generate-upload-url")) return json({ public_url: `https://cdn.test/u/${calls.length}.png`, upload_url: `https://s3.test/put/${calls.length}`, content_type: "image/png", upload_headers: { "Content-Type": "image/png", "x-amz-tagging": "retention=temporary" } });
    if (url.startsWith("https://s3.test/")) return new Response(null, { status: 200 });
    if (url.match(/\/requests\/[^/]+\/status$/)) {
      const seq = opts.statusSequence ?? ["in_progress", "completed"];
      const st = seq[Math.min(polled++, seq.length - 1)];
      return json({ status: st, request_id: url.split("/").at(-2), images: st === "completed" ? [{ url: "https://out.test/img.png" }] : undefined, error: st === "failed" ? "boom" : null });
    }
    if (url.match(/\/requests\/[^/]+\/cancel$/)) return new Response(null, { status: 202 });
    if (opts.rateLimitOnce && !rateLimited) {
      rateLimited = true;
      return json({ code: "account_queue_full", retryable: true, retry_after_seconds: 0 }, 429, { "retry-after": "0" });
    }
    if (opts.failSubmit) return json({ detail: "Invalid credentials" }, opts.failSubmit);
    const id = `req-${calls.length}`;
    return json({ status: "queued", request_id: id, status_url: `https://api.test/requests/${id}/status`, cancel_url: `https://api.test/requests/${id}/cancel` });
  }) as typeof fetch;
  const client = new HiggsfieldClient("KEYID:SECRET", "https://api.test", fetchImpl, async () => undefined);
  return { client, calls };
}

let ids: string[];
let sessionId: string;
beforeEach(async () => {
  freshBackends();
  __resetRateLimits();
  useBrowser("client-gen");
  ({ ids } = await seedLibrary(LIB));
  sessionId = (await startSession({ propertyId: "prop_andheri_atlas", floorPlanId: "fp_andheri_sample", offeringId: "off_demo_premium" })).id;
  __setDownloader((async () => new Response(new Uint8Array(await testPng("#ffffff", "#000000")), { headers: { "content-type": "image/png" } })) as typeof fetch);
});
afterEach(() => {
  __setHiggsfieldClient(null);
  __setDownloader(null);
});

const ready = async () => {
  await submitChoice(sessionId, { roomId: "rm_meeting_1", referenceId: ids[0] });
  await saveRoomSpec(sessionId, "rm_meeting_1", { unit: "m", length: 4, width: 4, height: 3, roomTypeId: "rt_meeting", occupancy: 6, intendedUse: "client meetings", doors: [{ id: "d", wall: "south", offset: 0.5, width: 1, height: 2.1, sillHeight: 0 }] });
};
const req = (extra: Record<string, unknown> = {}) => ({ modelId: "xai/grok-imagine-image-2.0", roles: [{ referenceId: ids[4], role: "lighting" }], confirmed: true, ...extra });

describe("Higgsfield client (documented API, mocked)", () => {
  it("authenticates with 'Key id:secret', sends Idempotency-Key, and uploads without credentials", async () => {
    const { client, calls } = fakeApi();
    const url = await client.uploadImage(Buffer.from("x"), "image/png");
    expect(url).toMatch(/^https:\/\/cdn\.test/);
    expect(calls[0].headers.Authorization).toBe("Key KEYID:SECRET");
    expect(calls[0].body).toEqual({ content_type: "image/png" });
    expect(calls[1].method).toBe("PUT");
    expect(calls[1].headers.Authorization).toBeUndefined();
    expect(calls[1].headers["x-amz-tagging"]).toBe("retention=temporary");
    await client.submit("/xai/grok-imagine-image-2.0", { prompt: "p" }, "idem-1");
    expect(calls[2].headers["Idempotency-Key"]).toBe("idem-1");
  });
  it("retries 429 with the same idempotency key and does not retry 401", async () => {
    const rl = fakeApi({ rateLimitOnce: true });
    const res = await rl.client.submit("/m", { prompt: "p" }, "k");
    expect(res.status).toBe("queued");
    expect(rl.calls.filter((c) => c.url.endsWith("/m")).map((c) => c.headers["Idempotency-Key"])).toEqual(["k", "k"]);
    const bad = fakeApi({ failSubmit: 401 });
    await expect(bad.client.submit("/m", { prompt: "p" }, "k")).rejects.toThrow(/did not accept the API credentials/);
    expect(bad.calls.length).toBe(1);
  });
  it("only sends documented fields for each model", () => {
    const grok = getModel("xai/grok-imagine-image-2.0")!;
    const body = buildRequestBody(grok, { prompt: "p", negativePrompt: "n", imageUrls: Array.from({ length: 12 }, (_, i) => `u${i}`), resolution: "2k", aspectRatio: "4:3", count: 3, extra: { quality: "medium", bogus: "x" } });
    expect(Object.keys(body).sort()).toEqual(["aspect_ratio", "image_urls", "prompt", "quality", "resolution"]);
    expect((body.image_urls as string[]).length).toBe(10);
    const soul = getModel("higgsfield-ai/soul/standard")!;
    expect(buildRequestBody(soul, { prompt: "p", imageUrls: ["u"], count: 3, resolution: "1k" })).toEqual({ prompt: "p", num_images: 3 });
  });
});

describe("generation orchestration", () => {
  it("requires explicit confirmation, and refuses when saved measurements are invalid", async () => {
    const { client } = fakeApi();
    __setHiggsfieldClient(client);
    await expect(createGeneration(sessionId, "rm_meeting_1", req({ confirmed: undefined }))).rejects.toThrow();
    await saveRoomSpec(sessionId, "rm_meeting_1", { unit: "m", length: 4, width: 4, height: 1.5, roomTypeId: "rt_meeting", occupancy: 4 });
    await expect(createGeneration(sessionId, "rm_meeting_1", req())).rejects.toThrow(/measurements have errors/);
  });

  it("reports a clear error when Higgsfield is not configured", async () => {
    await ready();
    await expect(createGeneration(sessionId, "rm_meeting_1", req())).rejects.toThrow(/No Higgsfield credential/);
  });

  it("uploads the actual reference images, submits, polls, stores the result and keeps it unapproved", async () => {
    await ready();
    const { client, calls } = fakeApi({ statusSequence: ["in_progress", "completed"] });
    __setHiggsfieldClient(client);
    const preview = await previewBrief(sessionId, "rm_meeting_1", { roles: [{ referenceId: ids[4], role: "lighting" }] }, "xai/grok-imagine-image-2.0");
    expect(preview.imagesSent).toBe(2);
    expect(preview.blockers).toEqual([]);

    const { jobs } = await createGeneration(sessionId, "rm_meeting_1", req({ alternatives: 2 }));
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.status === "submitted" && j.providerRequestId)).toBe(true);
    expect(calls.filter((c) => c.url.endsWith("/files/generate-upload-url"))).toHaveLength(2); // two references, uploaded once per batch
    const submit = calls.find((c) => c.url.endsWith("/xai/grok-imagine-image-2.0"))!;
    expect((submit.body as { image_urls: string[] }).image_urls).toHaveLength(2);
    expect((submit.body as { prompt: string }).prompt).toContain("Image 2 (REF-00005, project Gamma) is the lighting reference");
    expect(jobs[0].referenceInputs.map((r) => r.role)).toEqual(["primary", "lighting"]);

    await repo().update("generationJobs", jobs[0].id, { nextPollAt: null });
    let j = await refreshJob(jobs[0].id);
    expect(j.status).toBe("processing");
    await repo().update("generationJobs", jobs[0].id, { nextPollAt: null });
    j = await refreshJob(jobs[0].id);
    expect(j.status).toBe("completed");
    expect(j.outputAssetIds).toHaveLength(1);
    const asset = (await repo().get("generatedAssets", j.outputAssetIds[0]))!;
    expect(asset.reviewStatus).toBe("unreviewed");
    expect(asset.isHandoffAsset).toBe(false);
    expect(await blobs().get("generated-images", asset.blobKey)).not.toBeNull();

    // backoff: an immediate second refresh does not hit the provider
    const before = calls.length;
    await refreshJob(jobs[1].id);
    expect(calls.length).toBe(before);

    // designer approval is the only way to make it a handoff asset
    await recordReview({ sessionId, roomId: "rm_meeting_1", generatedAssetId: asset.id, action: "approve", comment: "Lovely" });
    expect((await repo().get("generatedAssets", asset.id))!.isHandoffAsset).toBe(true);
  });

  it("supports refinement of a generated image", async () => {
    await ready();
    const { client, calls } = fakeApi();
    __setHiggsfieldClient(client);
    const { jobs } = await createGeneration(sessionId, "rm_meeting_1", req());
    await repo().update("generationJobs", jobs[0].id, { nextPollAt: null, attempts: 1 });
    const done = await refreshJob(jobs[0].id).then(async (j) => (j.status === "completed" ? j : (await repo().update("generationJobs", j.id, { nextPollAt: null }), refreshJob(j.id))));
    const assetId = done.outputAssetIds[0];
    const r = await createGeneration(sessionId, "rm_meeting_1", req({ refinementOfAssetId: assetId }));
    expect(r.jobs[0].referenceInputs[0]).toMatchObject({ kind: "generated", referenceId: assetId });
    expect(calls.filter((c) => c.url.endsWith("/files/generate-upload-url")).length).toBe(5);
  });

  it("handles provider failure, moderation and cancellation", async () => {
    await ready();
    const failing = fakeApi({ statusSequence: ["nsfw"] });
    __setHiggsfieldClient(failing.client);
    const { jobs } = await createGeneration(sessionId, "rm_meeting_1", req());
    await repo().update("generationJobs", jobs[0].id, { nextPollAt: null });
    const f = await refreshJob(jobs[0].id);
    expect(f.status).toBe("failed");
    expect(f.error).toMatch(/moderation/);

    const ok = fakeApi();
    __setHiggsfieldClient(ok.client);
    const second = await createGeneration(sessionId, "rm_meeting_1", req());
    const c = await cancelJob(second.jobs[0].id);
    expect(c.cancelled).toBe(true);
    expect(c.job.status).toBe("cancelled");
    expect(ok.calls.some((x) => x.url.endsWith("/cancel") && x.method === "POST")).toBe(true);
  });

  it("marks the job failed when submission is rejected", async () => {
    await ready();
    const bad = fakeApi({ failSubmit: 403 });
    __setHiggsfieldClient(bad.client);
    const { jobs } = await createGeneration(sessionId, "rm_meeting_1", req());
    expect(jobs[0].status).toBe("failed");
    expect(jobs[0].error).toMatch(/insufficient balance/);
  });

  it("rate-limits generation per session", async () => {
    await ready();
    const { client } = fakeApi();
    __setHiggsfieldClient(client);
    for (let i = 0; i < 6; i++) await createGeneration(sessionId, "rm_meeting_1", req());
    await expect(createGeneration(sessionId, "rm_meeting_1", req())).rejects.toThrow(/Too many requests/);
  });
});

describe("credential handling", () => {
  const set = (o: Record<string, string>) => Object.assign(process.env, { HF_API_KEY_ID: "", HF_API_KEY_SECRET: "", HIGGSFIELD_API_KEY: "", HIGGSFIELF_API_KEY: "", ...o });
  afterEach(() => set({}));
  it("accepts the documented pair, the combined key, and the legacy misspelt name", () => {
    set({ HF_API_KEY_ID: "id", HF_API_KEY_SECRET: "sec" });
    expect(higgsfieldCredential()).toMatchObject({ credential: "id:sec", source: "HF_API_KEY_ID + HF_API_KEY_SECRET" });
    set({ HIGGSFIELF_API_KEY: "abc:def" });
    expect(higgsfieldCredential()).toMatchObject({ credential: "abc:def", source: "HIGGSFIELF_API_KEY" });
  });
  it("explains malformed or missing credentials without exposing them", () => {
    set({ HIGGSFIELD_API_KEY: "no-colon-here" });
    const r = higgsfieldCredential();
    expect(r.credential).toBeNull();
    expect(r.problem).toMatch(/format/);
    expect(r.problem).not.toContain("no-colon-here");
    set({});
    expect(higgsfieldCredential().problem).toMatch(/No Higgsfield credential/);
  });
});
