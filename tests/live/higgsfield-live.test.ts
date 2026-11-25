/**
 * OPTIONAL live generation test. This spends Higgsfield credits.
 * It only runs when ATLAS_ENABLE_LIVE_HIGGSFIELD_TEST=1 and is excluded from `npm test`.
 * Run: ATLAS_ENABLE_LIVE_HIGGSFIELD_TEST=1 npm run test:live
 */
import { describe, expect, it } from "vitest";
import { HiggsfieldClient } from "@/modules/higgsfield/client";
import { buildRequestBody, getModel } from "@/modules/higgsfield/models";

const enabled = process.env.ATLAS_ENABLE_LIVE_HIGGSFIELD_TEST === "1";
const cred = process.env.HF_API_KEY_ID && process.env.HF_API_KEY_SECRET ? `${process.env.HF_API_KEY_ID}:${process.env.HF_API_KEY_SECRET}` : (process.env.HIGGSFIELD_API_KEY ?? process.env.HIGGSFIELF_API_KEY ?? "");

describe.skipIf(!enabled || !cred)("LIVE Higgsfield generation (spends credits)", () => {
  it("generates one low-quality 1k image with Grok Image 2.0 and polls to completion", async () => {
    const client = new HiggsfieldClient(cred, process.env.HIGGSFIELD_API_BASE ?? "https://api.higgsfield.ai");
    const model = getModel("xai/grok-imagine-image-2.0")!;
    const body = buildRequestBody(model, { prompt: "A small modern meeting room with a natural wood table, photorealistic.", imageUrls: [], resolution: "1k", aspectRatio: "4:3", extra: { quality: "low" } });
    const sub = await client.submit(model.endpoint, body, `atlas-live-${Date.now()}`);
    expect(sub.request_id).toBeTruthy();
    let st = sub;
    for (let i = 0; i < 60 && !["completed", "failed", "nsfw", "canceled"].includes(st.status); i++) {
      await new Promise((r) => setTimeout(r, Math.min(10000, 2000 * 1.5 ** i)));
      st = await client.status(sub.request_id);
    }
    expect(st.status).toBe("completed");
    expect(st.images?.[0]?.url).toMatch(/^https:/);
    console.log("Live request id:", sub.request_id);
  }, 600_000);
});
