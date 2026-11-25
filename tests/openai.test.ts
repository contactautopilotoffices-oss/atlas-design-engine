import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveOpenAISize, getAnyModel } from "@/modules/generation/models";
import { createGeneration, previewBrief } from "@/modules/generation/orchestrator";
import { generateRoomOptions, roomOptions } from "@/modules/generation/options";
import { OpenAIClient } from "@/modules/openai/client";
import { __setOpenAIClient, openaiCredential } from "@/modules/openai/config";
import { blobs, repo } from "@/modules/persistence";
import { __resetRateLimits } from "@/modules/security/rate-limit";
import { startSession, submitChoice } from "@/modules/selections/service";
import { saveRoomSpec } from "@/modules/spatial/service";
import { freshBackends, testPng, useBrowser } from "./helpers/env";
import { LIB, seedLibrary } from "./helpers/scenario";

type CapturedCall = { url: string; method: string; headers: Record<string, string>; jsonBody?: Record<string, unknown>; formEntries?: Array<[string, string]> };

async function fakeOpenAIApi(opts: { failStatus?: number; failCode?: string; failMessage?: string; rateLimitOnce?: boolean; count?: number } = {}) {
  const calls: CapturedCall[] = [];
  let rateLimited = false;
  const imgBytes = await testPng("#f2ede4", "#8a6a45", 800, 600);
  const b64 = imgBytes.toString("base64");

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const rec: CapturedCall = { url, method: init?.method ?? "GET", headers };
    if (typeof init?.body === "string") {
      rec.jsonBody = JSON.parse(init.body) as Record<string, unknown>;
    } else if (init?.body instanceof FormData) {
      const entries: Array<[string, string]> = [];
      for (const [k, v] of init.body.entries()) {
        entries.push([k, typeof v === "string" ? v : `<file:${v.name}:${v.type}>`]);
      }
      rec.formEntries = entries;
    }
    calls.push(rec);

    const json = (o: unknown, status = 200, h: Record<string, string> = {}) =>
      new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...h } });

    if (opts.rateLimitOnce && !rateLimited) {
      rateLimited = true;
      return json({ error: { message: "Rate limit", code: "rate_limit_exceeded" } }, 429, { "retry-after": "0" });
    }
    if (opts.failStatus) {
      return json({ error: { message: opts.failMessage ?? "Quota exceeded", code: opts.failCode ?? "insufficient_quota" } }, opts.failStatus);
    }
    const n = Number(rec.jsonBody?.n ?? rec.formEntries?.find(([k]) => k === "n")?.[1] ?? opts.count ?? 1);
    return json({
      created: Math.floor(Date.now() / 1000),
      data: Array.from({ length: n }, () => ({ b64_json: b64 })),
      usage: { input_tokens: 120, output_tokens: 1056 * n, total_tokens: 120 + 1056 * n },
    });
  }) as typeof fetch;

  const client = new OpenAIClient("sk-test-secret-never-leak", "https://openai.test", fetchImpl, async () => undefined);
  return { client, calls };
}

let ids: string[];
let sessionId: string;

beforeEach(async () => {
  freshBackends();
  __resetRateLimits();
  useBrowser("openai-test");
  ({ ids } = await seedLibrary(LIB));
  sessionId = (await startSession({ propertyId: "prop_andheri_atlas", floorPlanId: "fp_andheri_sample", offeringId: "off_demo_premium" })).id;
});

afterEach(() => {
  __setOpenAIClient(null);
  process.env.OPENAI_API_KEY = "";
});

const ready = async () => {
  await submitChoice(sessionId, { roomId: "rm_meeting_1", referenceId: ids[0] });
  await saveRoomSpec(sessionId, "rm_meeting_1", { unit: "m", length: 4, width: 4, height: 3, roomTypeId: "rt_meeting", occupancy: 6 });
};

describe("OpenAI image client and sizes", () => {
  it("maps documented resolutions and aspect ratios to divisible-by-16 OpenAI sizes", () => {
    const sunburst = getAnyModel("openai/gpt-image-2.6-sunburst")!;
    expect(resolveOpenAISize(sunburst, "1k", "4:3")).toBe("1344x1008");
    expect(resolveOpenAISize(sunburst, "2k", "16:9")).toBe("2048x1152");
    expect(resolveOpenAISize(sunburst, "1k", "auto")).toBe("auto");
    const mini = getAnyModel("openai/gpt-image-1-mini")!;
    expect(resolveOpenAISize(mini, "standard", "3:2")).toBe("1536x1024");
  });

  it("sends Bearer auth, uses generations without images, edits with image/image[], and never sends response_format", async () => {
    const { client, calls } = await fakeOpenAIApi();
    await client.generate({ model: "gpt-image-2.6-sunburst", prompt: "room", n: 2, size: "1344x1008", quality: "medium", outputFormat: "png" });
    expect(calls[0].url).toBe("https://openai.test/v1/images/generations");
    expect(calls[0].headers.authorization).toBe("Bearer sk-test-secret-never-leak");
    expect(calls[0].jsonBody).not.toHaveProperty("response_format");

    const png = await testPng("#ffffff", "#000000");
    await client.edit({
      model: "gpt-image-2.6-sunburst",
      prompt: "single",
      n: 1,
      size: "auto",
      images: [{ data: png, contentType: "image/png", filename: "ref-1.png" }],
    });
    expect(calls[1].url).toBe("https://openai.test/v1/images/edits");
    expect(calls[1].formEntries!.filter(([k]) => k === "image")).toHaveLength(1);

    await client.edit({
      model: "gpt-image-2.6-sunburst",
      prompt: "multi",
      n: 2,
      images: [
        { data: png, contentType: "image/png", filename: "ref-1.png" },
        { data: png, contentType: "image/png", filename: "ref-2.png" },
      ],
    });
    expect(calls[2].formEntries!.filter(([k]) => k === "image[]")).toHaveLength(2);
  });

  it("retries transient 429 rate limits and does not retry quota/auth errors or leak key", async () => {
    const rl = await fakeOpenAIApi({ rateLimitOnce: true });
    const res = await rl.client.generate({ model: "gpt-image-2.6-flare", prompt: "test" });
    expect(res.data).toHaveLength(1);
    expect(rl.calls).toHaveLength(2);

    const bad = await fakeOpenAIApi({ failStatus: 401, failCode: "invalid_api_key", failMessage: "Incorrect API key provided" });
    await expect(bad.client.generate({ model: "gpt-image-2.6-flare", prompt: "test" })).rejects.toThrow(/did not accept the API key/);
    expect(bad.calls).toHaveLength(1);

    const quota = await fakeOpenAIApi({ failStatus: 429, failCode: "insufficient_quota" });
    await expect(quota.client.generate({ model: "gpt-image-2.6-flare", prompt: "test" })).rejects.toThrow(/insufficient quota/);
    expect(quota.calls).toHaveLength(1);
  });

  it("checks credential status without exposing the secret", () => {
    process.env.OPENAI_API_KEY = "sk-very-secret-token";
    const c = openaiCredential();
    expect(c.source).toBe("OPENAI_API_KEY");
    expect(c.problem).toBeNull();
    process.env.OPENAI_API_KEY = "";
    expect(openaiCredential().problem).toMatch(/No OpenAI API key/);
  });
});

describe("OpenAI generation orchestration", () => {
  it("generates unreviewed assets via /v1/images/edits, supports refinement, and records usage", async () => {
    await ready();
    const { client, calls } = await fakeOpenAIApi();
    __setOpenAIClient(client);
    process.env.OPENAI_API_KEY = "sk-test-key";

    const preview = await previewBrief(sessionId, "rm_meeting_1", { roles: [{ referenceId: ids[4], role: "lighting" }] });
    // Higgsfield is unconfigured and OpenAI is configured, so preview falls back to OpenAI automatically.
    expect(preview.model.provider).toBe("openai");
    expect(preview.provider.configured).toBe(true);

    const { jobs } = await createGeneration(sessionId, "rm_meeting_1", {
      modelId: "openai/gpt-image-2.6-sunburst",
      roles: [{ referenceId: ids[4], role: "lighting" }],
      alternatives: 3,
      resolution: "1k",
      aspectRatio: "4:3",
      extra: { quality: "high" },
      confirmed: true,
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("completed");
    expect(jobs[0].outputAssetIds).toHaveLength(3);
    expect(jobs[0].costNote).toContain("OpenAI usage");
    expect(calls[0].formEntries!.filter(([k]) => k === "image[]")).toHaveLength(2);
    expect(calls[0].formEntries).toContainEqual(["quality", "high"]);
    expect(calls[0].formEntries).toContainEqual(["size", "1344x1008"]);

    const asset = (await repo().get("generatedAssets", jobs[0].outputAssetIds[0]))!;
    expect(asset.reviewStatus).toBe("unreviewed");
    expect(asset.isHandoffAsset).toBe(false);
    expect(await blobs().get("generated-images", asset.blobKey)).not.toBeNull();

    // Supports refinement with OpenAI
    const refined = await createGeneration(sessionId, "rm_meeting_1", {
      modelId: "openai/gpt-image-2.6-flare",
      refinementOfAssetId: asset.id,
      alternatives: 1,
      confirmed: true,
    });
    expect(refined.jobs[0].status).toBe("completed");
    expect(refined.jobs[0].referenceInputs[0]).toMatchObject({ kind: "generated", referenceId: asset.id });
  });

  it("enables popup AI room options automatically when OpenAI is configured", async () => {
    const { client } = await fakeOpenAIApi();
    __setOpenAIClient(client);
    process.env.OPENAI_API_KEY = "sk-test-key";

    const opts = await roomOptions(sessionId, "rm_meeting_1");
    expect(opts.ai.available).toBe(true);
    expect(opts.ai.defaultModelId).toBe("openai/gpt-image-2.6-sunburst");

    const { jobs } = await generateRoomOptions(sessionId, "rm_meeting_1", 4, true, "openai/gpt-image-2.6-flare");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("completed");
    expect(jobs[0].outputAssetIds).toHaveLength(4);
    const after = await roomOptions(sessionId, "rm_meeting_1");
    expect(after.generated).toHaveLength(4);
  });
});
