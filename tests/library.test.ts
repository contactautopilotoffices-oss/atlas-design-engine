import { beforeEach, describe, expect, it } from "vitest";
import { ReferenceMetadata } from "@/modules/core/schemas";
import { discoverDirections } from "@/modules/intelligence/directions";
import { getReferenceView, mergeDirections, portfolioIntelligence, saveDirection, searchReferences, updateReference } from "@/modules/intelligence/library";
import { compareReferences } from "@/modules/intelligence/similarity";
import { checkEligibility } from "@/modules/offerings/eligibility";
import { repo } from "@/modules/persistence";
import { freshBackends } from "./helpers/env";
import { LIB, seedLibrary } from "./helpers/scenario";

let ids: string[];
beforeEach(async () => {
  freshBackends();
  ({ ids } = await seedLibrary(LIB));
});

describe("reference library and intelligence", () => {
  it("edits metadata with provenance and keeps sampled colours as observed", async () => {
    const ref = (await repo().get("references", ids[0]))!;
    expect(ref.provenance["materials.flooring"]).toBe("human");
    expect(ref.provenance["colors.palette"]).toBe("observed");
    expect(ref.reviewStatus).toBe("approved");
    expect(ref.reviewedBy).toBe("test");
  });

  it("refuses dimensions without a measurement source", async () => {
    const ref = (await repo().get("references", ids[0]))!;
    const md = ReferenceMetadata.parse({ ...ref.metadata, dimensions: { ...ref.metadata.dimensions, length: 4, width: 4 } });
    await expect(updateReference(ids[0], { metadata: md }, "t")).rejects.toThrow(/never estimated from photos/);
  });

  it("filters by room type, project, material, text and colour", async () => {
    expect((await searchReferences({ roomTypeId: "rt_meeting" })).total).toBe(3);
    const volt = [...(await repo().list("projects"))].find((p) => p.name === "Volt")!;
    expect((await searchReferences({ projectId: volt.id })).total).toBe(2);
    expect((await searchReferences({ material: "glass" })).total).toBe(3);
    expect((await searchReferences({ q: "industrial" })).total).toBe(1);
    const brownish = await searchReferences({ colour: "#E8E1D6", colourTolerance: 8 });
    expect(brownish.references.map((r) => r.id)).toContain(ids[0]);
    expect(brownish.references.map((r) => r.id)).not.toContain(ids[2]);
  });

  it("applies configurable offering rules (excluded materials, tagged mode, approval)", async () => {
    const offerings = await repo().list("offerings");
    const essential = offerings.find((o) => o.id === "off_demo_essential")!;
    const marbleRef = (await repo().get("references", ids[1]))!;
    const e = checkEligibility(marbleRef, essential, offerings);
    expect(e.eligible).toBe(false);
    expect(e.reasons.join(" ")).toMatch(/Marble/);
    const premium = offerings.find((o) => o.id === "off_demo_premium")!;
    expect(checkEligibility(marbleRef, premium, offerings).eligible).toBe(true);
    const tagged = { ...premium, rules: { ...premium.rules, mode: "tagged" as const, inheritLowerTiers: false } };
    expect(checkEligibility(marbleRef, tagged, offerings).eligible).toBe(false);
    const res = await searchReferences({ offeringId: "off_demo_essential", roomTypeId: "rt_boardroom" });
    expect(res.total).toBe(0);
  });

  it("explains similarity with shared attributes, preferring the true look-alike", async () => {
    const refs = await repo().list("references");
    const volt = refs.find((r) => r.id === ids[0])!;
    const gamma = refs.find((r) => r.id === ids[3])!;
    const beta = refs.find((r) => r.id === ids[2])!;
    const close = compareReferences(volt, gamma);
    const far = compareReferences(volt, beta);
    expect(close.score).toBeGreaterThan(far.score);
    expect(close.basis.join(" ")).toMatch(/natural wood/);
    const view = await getReferenceView(volt.id);
    expect(view.similar[0].reference.id).toBe(gamma.id);
  });

  it("finds recurring patterns, unique traits and suggests up to four directions", async () => {
    const intel = await portfolioIntelligence();
    expect(intel.recurring.some((p) => p.label === "glass + natural wood" && p.projects.length === 2)).toBe(true);
    expect(intel.unique.some((u) => u.traits.some((t) => t.value === "marble"))).toBe(true);
    expect(intel.discovery.suggestions.length).toBeGreaterThan(0);
    expect(intel.discovery.suggestions.length).toBeLessThanOrEqual(4);
    expect(intel.semanticSearch.operational).toBe(false);
    const tooFew = discoverDirections((await repo().list("references")).slice(0, 2));
    expect(tooFew.suggestions).toHaveLength(0);
  });

  it("saves, approves and merges design directions", async () => {
    const a = await saveDirection({ name: "Warm Minimal", description: "", status: "approved", source: "manual", referenceIds: [ids[0], ids[3]] }, "t");
    expect((await repo().get("references", ids[0]))!.metadata.designDirectionId).toBe(a.id);
    const b = await saveDirection({ name: "Dark Industrial", description: "", status: "suggested", source: "manual", referenceIds: [ids[2]] }, "t");
    const merged = await mergeDirections([a.id, b.id], "Contemporary", "t");
    expect(merged.referenceIds.sort()).toEqual([ids[0], ids[2], ids[3]].sort());
    expect((await repo().get("designDirections", a.id))!.status).toBe("archived");
  });
});
