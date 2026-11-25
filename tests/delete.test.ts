import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureBootstrapped } from "@/modules/core/bootstrap";
import { deleteGeneratedAsset, deleteGenerationJob, createGeneration } from "@/modules/generation/orchestrator";
import { deleteDocument, deleteProject, deleteReference, ingestFile, createProject } from "@/modules/ingestion/service";
import { deleteDirection, saveDirection } from "@/modules/intelligence/library";
import { OpenAIClient } from "@/modules/openai/client";
import { __setOpenAIClient } from "@/modules/openai/config";
import { blobs, repo } from "@/modules/persistence";
import { recordReview } from "@/modules/review/service";
import { __resetRateLimits } from "@/modules/security/rate-limit";
import { deleteSession, startSession, submitChoice } from "@/modules/selections/service";
import { saveRoomSpec } from "@/modules/spatial/service";
import { freshBackends, testPng, useBrowser } from "./helpers/env";
import { makePdf } from "./helpers/fixtures";
import { LIB, seedLibrary } from "./helpers/scenario";

beforeEach(async () => {
  freshBackends();
  __resetRateLimits();
  useBrowser("delete-test");
  await ensureBootstrapped();
});

afterEach(() => {
  __setOpenAIClient(null);
  process.env.OPENAI_API_KEY = "";
});

describe("cascade deletion for references, PDF documents, projects, sessions, directions and AI assets", () => {
  it("deletes an individual extracted PDF image, cleans up blobs, directions, offerings, and updates document count", async () => {
    const p = await createProject({ name: "PDF Proj", clientName: "", propertyName: "", city: "", category: "" }, "staff:admin");
    const { document } = await ingestFile({ projectId: p.id, filename: "slides.pdf", data: await makePdf(), actor: "staff:admin" });
    const refs = await repo().list("references", { documentId: document.id });
    expect(refs).toHaveLength(3);

    const target = refs[0];
    const dir = await saveDirection({ name: "Test Dir", description: "", status: "approved", source: "manual", referenceIds: [target.id, refs[1].id] }, "staff:admin");
    await repo().update("offerings", "off_demo_premium", {
      rules: { ...(await repo().get("offerings", "off_demo_premium"))!.rules, includeReferenceIds: [target.id] },
    });

    await deleteReference(target.id, "staff:admin");
    expect(await repo().get("references", target.id)).toBeNull();
    expect(await blobs().get("reference-images", target.blobKey)).toBeNull();
    expect(await blobs().get("reference-thumbnails", target.thumbKey)).toBeNull();
    expect((await repo().get("sourceDocuments", document.id))!.extractedImageCount).toBe(2);
    expect((await repo().get("designDirections", dir.id))!.referenceIds).toEqual([refs[1].id]);
    expect((await repo().get("offerings", "off_demo_premium"))!.rules.includeReferenceIds).toEqual([]);
  });

  it("blocks deleting a reference used by a client session unless force=true", async () => {
    const { ids } = await seedLibrary(LIB);
    const session = await startSession({ propertyId: "prop_andheri_atlas", floorPlanId: "fp_andheri_sample", offeringId: "off_demo_premium" });
    await submitChoice(session.id, { roomId: "rm_meeting_1", referenceId: ids[0] });

    await expect(deleteReference(ids[0], "staff:admin")).rejects.toThrow(/client design session/);
    expect(await repo().get("references", ids[0])).not.toBeNull();

    await deleteReference(ids[0], "staff:admin", { force: true });
    expect(await repo().get("references", ids[0])).toBeNull();
    expect(await repo().list("selections", { sessionId: session.id })).toHaveLength(0);
    expect(await repo().list("selectionRevisions", { sessionId: session.id })).toHaveLength(0);
  });

  it("deletes a PDF document and all its extracted images while keeping other project documents", async () => {
    const p = await createProject({ name: "Multi Doc", clientName: "", propertyName: "", city: "", category: "" }, "staff:admin");
    const pdfRes = await ingestFile({ projectId: p.id, filename: "deck.pdf", data: await makePdf(), actor: "staff:admin" });
    const imgRes = await ingestFile({ projectId: p.id, filename: "extra.png", data: await testPng("#224466", "#aaccee"), actor: "staff:admin" });

    await deleteDocument(pdfRes.document.id, "staff:admin");
    expect(await repo().get("sourceDocuments", pdfRes.document.id)).toBeNull();
    expect(await blobs().get("source-documents", pdfRes.document.blobKey)).toBeNull();
    expect(await repo().list("references", { documentId: pdfRes.document.id })).toHaveLength(0);

    // Standalone image document in the same project remains untouched
    expect(await repo().get("sourceDocuments", imgRes.document.id)).not.toBeNull();
    expect(await repo().list("references", { projectId: p.id })).toHaveLength(1);
  });

  it("deletes an entire project with all documents, references and blobs", async () => {
    const p = await createProject({ name: "Full Wipe", clientName: "", propertyName: "", city: "", category: "" }, "staff:admin");
    const res = await ingestFile({ projectId: p.id, filename: "deck.pdf", data: await makePdf(), actor: "staff:admin" });
    const refs = await repo().list("references", { projectId: p.id });

    await deleteProject(p.id, "staff:admin");
    expect(await repo().get("projects", p.id)).toBeNull();
    expect(await repo().get("sourceDocuments", res.document.id)).toBeNull();
    expect(await blobs().get("source-documents", res.document.blobKey)).toBeNull();
    expect(await repo().list("references", { projectId: p.id })).toHaveLength(0);
    for (const r of refs) {
      expect(await blobs().get("reference-images", r.blobKey)).toBeNull();
      expect(await blobs().get("reference-thumbnails", r.thumbKey)).toBeNull();
    }
  });

  it("deletes generated AI assets, generation jobs, design directions, and full sessions cleanly", async () => {
    const { ids } = await seedLibrary(LIB);
    const dir = await saveDirection({ name: "Warm Oak", description: "", status: "approved", source: "manual", referenceIds: [ids[0]] }, "staff:admin");
    expect((await repo().get("references", ids[0]))!.metadata.designDirectionId).toBe(dir.id);
    await deleteDirection(dir.id, "staff:admin");
    expect(await repo().get("designDirections", dir.id)).toBeNull();
    expect((await repo().get("references", ids[0]))!.metadata.designDirectionId).toBeNull();

    const img = (await testPng("#ffffff", "#111111")).toString("base64");
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: [{ b64_json: img }, { b64_json: img }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    __setOpenAIClient(new OpenAIClient("sk-test", "https://openai.test", fetchImpl, async () => undefined));
    process.env.OPENAI_API_KEY = "sk-test";

    const session = await startSession({ propertyId: "prop_andheri_atlas", floorPlanId: "fp_andheri_sample", offeringId: "off_demo_premium" });
    await submitChoice(session.id, { roomId: "rm_meeting_1", referenceId: ids[0] });
    await saveRoomSpec(session.id, "rm_meeting_1", { unit: "m", length: 4, width: 4, height: 3, roomTypeId: "rt_meeting", occupancy: 4 });
    const { jobs } = await createGeneration(session.id, "rm_meeting_1", { modelId: "openai/gpt-image-2.6-sunburst", alternatives: 2, roles: [], confirmed: true });
    const [a1, a2] = jobs[0].outputAssetIds;

    await submitChoice(session.id, { roomId: "rm_meeting_1", generatedAssetId: a1 });
    await recordReview({ sessionId: session.id, roomId: "rm_meeting_1", generatedAssetId: a1, action: "approve", comment: "Looks great" });

    // Deleting a1 clears generatedAssetId on selections/reviews/jobs and removes the blob
    const asset1 = (await repo().get("generatedAssets", a1))!;
    await deleteGeneratedAsset(a1);
    expect(await repo().get("generatedAssets", a1)).toBeNull();
    expect(await blobs().get("generated-images", asset1.blobKey)).toBeNull();
    expect((await repo().list("selections", { sessionId: session.id }))[0].generatedAssetId).toBeNull();
    expect((await repo().get("generationJobs", jobs[0].id))!.outputAssetIds).toEqual([a2]);

    // Deleting the job deletes remaining asset a2 as well
    const asset2 = (await repo().get("generatedAssets", a2))!;
    await deleteGenerationJob(jobs[0].id);
    expect(await repo().get("generationJobs", jobs[0].id)).toBeNull();
    expect(await repo().get("generatedAssets", a2)).toBeNull();
    expect(await blobs().get("generated-images", asset2.blobKey)).toBeNull();

    // Deleting the session cascades remaining selections, revisions, specs and reviews
    await deleteSession(session.id);
    expect(await repo().get("designSessions", session.id)).toBeNull();
    expect(await repo().list("selections", { sessionId: session.id })).toHaveLength(0);
    expect(await repo().list("roomSpecs", { sessionId: session.id })).toHaveLength(0);
    expect(await repo().list("designerReviews", { sessionId: session.id })).toHaveLength(0);
  });
});
