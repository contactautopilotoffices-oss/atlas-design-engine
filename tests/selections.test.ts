import { beforeEach, describe, expect, it } from "vitest";
import { LocalJsonRepository } from "@/modules/persistence/local-json-store";
import { repo } from "@/modules/persistence";
import { sessionSummary, startSession, submitChoice } from "@/modules/selections/service";
import { freshBackends, useBrowser } from "./helpers/env";
import { LIB, seedLibrary } from "./helpers/scenario";

let ids: string[];
let dataDir: string;
beforeEach(async () => {
  ({ dataDir } = freshBackends() as { dataDir: string });
  useBrowser("client-1");
  ({ ids } = await seedLibrary(LIB));
});

const open = () => startSession({ propertyId: "prop_andheri_atlas", floorPlanId: "fp_andheri_sample", offeringId: "off_demo_premium", clientName: "Acme" });

describe("client selection workflow", () => {
  it("submits a choice, records revision history and persists to store.json", async () => {
    const s = await open();
    const r1 = await submitChoice(s.id, { roomId: "rm_meeting_1", referenceId: ids[0] });
    expect(r1.selection.revision).toBe(1);
    expect(r1.selection.snapshot).toMatchObject({ projectName: "Volt", referenceCode: "REF-00001", sourcePage: null });
    const r2 = await submitChoice(s.id, { roomId: "rm_meeting_1", referenceId: ids[3] });
    expect(r2.selection.revision).toBe(2);
    expect(r2.selection.id).toBe(r1.selection.id);

    // simulate server restart: a brand-new repository reading the same file
    const restarted = new LocalJsonRepository(dataDir);
    const sel = (await restarted.list("selections", { sessionId: s.id }))[0];
    expect(sel).toMatchObject({ roomId: "rm_meeting_1", referenceId: ids[3], revision: 2, offeringId: "off_demo_premium", roomTypeId: "rt_meeting" });
    expect((await restarted.list("selectionRevisions", { sessionId: s.id })).map((r) => r.revision).sort()).toEqual([1, 2]);

    const summary = await sessionSummary(s.id);
    const room = summary.rooms.find((r) => r.room.id === "rm_meeting_1")!;
    expect(room.revisions.map((r) => r.revision)).toEqual([2, 1]);
    expect(room.selection?.reference?.id).toBe(ids[3]);
    expect((summary.session as { ownerTokenHash?: string }).ownerTokenHash).toBeUndefined();
  });

  it("never gives two concurrent submits the same revision", async () => {
    const s = await open();
    const results = await Promise.all([ids[0], ids[3], ids[2], ids[0], ids[3]].map((ref) => submitChoice(s.id, { roomId: "rm_meeting_2", referenceId: ref })));
    expect(results.map((r) => r.selection.revision).sort()).toEqual([1, 2, 3, 4, 5]);
    expect((await repo().list("selections", { sessionId: s.id })).length).toBe(1);
  });

  it("rejects wrong room types and references outside the offering", async () => {
    const s = await open();
    await expect(submitChoice(s.id, { roomId: "rm_meeting_1", referenceId: ids[1] })).rejects.toThrow(/different room type/);
    const ess = await startSession({ propertyId: "prop_andheri_atlas", floorPlanId: "fp_andheri_sample", offeringId: "off_demo_essential" });
    await expect(submitChoice(ess.id, { roomId: "rm_boardroom", referenceId: ids[1] })).rejects.toThrow(/not available under/);
  });

  it("blocks other browsers from reading or changing a session (staff passcode configured)", async () => {
    process.env.ATLAS_ADMIN_PASSCODE = "correct horse";
    try {
      const s = await open();
      useBrowser("someone-else");
      await expect(sessionSummary(s.id)).rejects.toThrow(/another browser/);
      await expect(submitChoice(s.id, { roomId: "rm_meeting_1", referenceId: ids[0] })).rejects.toThrow(/another browser/);
      useBrowser("client-1");
      await expect(sessionSummary(s.id)).resolves.toBeTruthy();
    } finally {
      process.env.ATLAS_ADMIN_PASSCODE = "";
    }
  });

  it("does not create any generation job when a choice is submitted", async () => {
    const s = await open();
    await submitChoice(s.id, { roomId: "rm_meeting_1", referenceId: ids[0] });
    expect(await repo().list("generationJobs")).toHaveLength(0);
  });
});
