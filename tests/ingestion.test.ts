import { beforeEach, describe, expect, it } from "vitest";
import { createProject, ingestFile, projectStats } from "@/modules/ingestion/service";
import { freshBackends, testPng } from "./helpers/env";
import { makePdf, makePptx } from "./helpers/fixtures";

let repo: ReturnType<typeof freshBackends>["repo"];
let blobs: ReturnType<typeof freshBackends>["blobs"];
let projectId: string;
beforeEach(async () => {
  ({ repo, blobs } = freshBackends());
  projectId = (await createProject({ name: "Volt", clientName: "", propertyName: "Sky Tower", city: "Mumbai", category: "Office" }, "test")).id;
});

describe("ingestion", () => {
  it("extracts PDF images with page numbers, text, thumbnails and sampled colours", async () => {
    const r = await ingestFile({ projectId, filename: "volt.pdf", data: await makePdf(), actor: "test" });
    expect(r.document.kind).toBe("pdf");
    expect(r.document.status).toBe("processed");
    expect(r.document.pageCount).toBe(3);
    expect(r.createdReferences).toBe(3);
    const refs = (await repo.list("references", { documentId: r.document.id })).sort((a, b) => a.referenceCode.localeCompare(b.referenceCode));
    expect(refs.map((x) => x.sourcePage)).toEqual([1, 3, 3]);
    expect(refs[0].referenceCode).toBe("REF-00001");
    expect(refs[0].sourceText).toContain("Project Volt meeting room");
    expect(refs[0].sourceFilename).toBe("volt.pdf");
    expect(refs[0].reviewStatus).toBe("pending");
    expect(refs[0].metadata.colors.palette.length).toBeGreaterThan(0);
    expect(refs[0].provenance["colors.primary"]).toBe("observed");
    expect(refs[0].metadata.dimensions.length).toBeNull(); // never inferred from images
    expect(r.document.pageText.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(await blobs.get("reference-thumbnails", refs[0].thumbKey)).not.toBeNull();
    expect(await blobs.get("source-documents", r.document.blobKey)).not.toBeNull();
  });

  it("does not duplicate when the same PDF is uploaded again", async () => {
    const pdf = await makePdf();
    await ingestFile({ projectId, filename: "volt.pdf", data: pdf, actor: "test" });
    const again = await ingestFile({ projectId, filename: "volt-copy.pdf", data: pdf, actor: "test" });
    expect(again.alreadyProcessed).toBe(true);
    expect((await repo.list("references")).length).toBe(3);
  });

  it("skips duplicate images that appear again in a different file of the same project", async () => {
    await ingestFile({ projectId, filename: "volt.pdf", data: await makePdf(), actor: "test" });
    const second = await ingestFile({ projectId, filename: "volt-v2.pdf", data: await makePdf("Revised deck"), actor: "test" });
    expect(second.alreadyProcessed).toBe(false);
    expect(second.createdReferences).toBe(0);
    expect(second.duplicateImages).toBe(3);
    expect((await repo.list("references")).length).toBe(3);
  });

  it("extracts PPTX slides in presentation order with text and embedded images, skipping vectors", async () => {
    const r = await ingestFile({ projectId, filename: "deck.pptx", data: await makePptx(), actor: "test" });
    expect(r.document.kind).toBe("pptx");
    expect(r.document.pageCount).toBe(2);
    expect(r.document.status).toBe("partial"); // EMF skipped and reported
    expect(r.document.errors.some((e) => e.page === 2 && /image3\.emf/.test(e.message))).toBe(true);
    const refs = await repo.list("references", { documentId: r.document.id });
    const bySlide = Object.fromEntries(refs.map((x) => [x.sourcePage, x]));
    expect(bySlide[1].sourceText).toContain("Reception & lobby");
    expect(bySlide[2].sourceText).toContain("Cabin concept");
    expect(refs).toHaveLength(2); // the small logo on slide 1 is left out
    expect(r.document.skippedSmallCount).toBe(1);
    expect(refs.every((x) => x.sourceKind === "pptx-slide")).toBe(true);
  });

  it("accepts individual images and records them as standalone references", async () => {
    const r = await ingestFile({ projectId, filename: "photo.png", data: await testPng("#111111", "#eeeeee"), actor: "test" });
    const [ref] = await repo.list("references", { documentId: r.document.id });
    expect(ref.sourceKind).toBe("image-file");
    expect(ref.sourcePage).toBeNull();
  });

  it("handles bad input: corrupt PDF, legacy PPT, unsupported files", async () => {
    const corrupt = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("garbage".repeat(50))]);
    const bad = await ingestFile({ projectId, filename: "broken.pdf", data: corrupt, actor: "test" });
    expect(bad.document.status).toBe("failed");
    expect(bad.document.errors[0].message).toMatch(/Could not read/);
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    await expect(ingestFile({ projectId, filename: "old.ppt", data: ole, actor: "test" })).rejects.toThrow(/save it as \.pptx/);
    await expect(ingestFile({ projectId, filename: "notes.txt", data: Buffer.from("hello"), actor: "test" })).rejects.toThrow(/not a supported file/);
    await expect(ingestFile({ projectId, filename: "x.pdf", data: Buffer.alloc(0), actor: "test" })).rejects.toThrow(/empty/);
  });

  it("reports project stats", async () => {
    await ingestFile({ projectId, filename: "volt.pdf", data: await makePdf(), actor: "test" });
    const [p] = await projectStats();
    expect(p).toMatchObject({ name: "Volt", extractedImages: 3, reviewedReferences: 0, processingStatus: "processed" });
  });
});
