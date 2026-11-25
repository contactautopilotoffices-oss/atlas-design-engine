import "server-only";
/**
 * AI PDF & Reference Scanner:
 *   1. Scans Cover / Layout / Mood Board PDF pages via Claude Vision for project details,
 *      color & material palettes, and the room legend table.
 *   2. Automatically imports the 2D floor plan page as a Draft FloorPlan (if present).
 *   3. Runs Claude Vision across extracted images to distinguish 3D renders from 2D key plans /
 *      mood boards and auto-fill materials, lighting, furniture, design language, and roomTypeId
 *      with provenance "ai" (never overwriting human edits or observed pixel colours).
 */
import sharp from "sharp";
import { getDocumentProxy, renderPageAsImage } from "unpdf";
import { audit } from "@/modules/core/audit";
import type { PdfScanSummary, ReferenceAsset, RoomType } from "@/modules/core/schemas";
import { notFound, now } from "@/modules/core/util";
import { importPlan } from "@/modules/floorplans/service";
import { guessPlanPage } from "@/modules/floorplans/source";
import { blobs, repo } from "@/modules/persistence";
import { getVisionProvider, scanPdfOverviewWithClaude } from "./vision";

function mergeAiMetadata(
  existing: ReferenceAsset["metadata"],
  provenance: Record<string, "observed" | "human" | "ai" | "source-text">,
  ai: Partial<ReferenceAsset["metadata"]>,
) {
  const next = structuredClone(existing);
  const nextProv = { ...provenance };
  const setIfNotHuman = <K extends keyof ReferenceAsset["metadata"]>(key: K, provKey: string, val: ReferenceAsset["metadata"][K] | undefined) => {
    if (val === undefined || nextProv[provKey] === "human") return;
    next[key] = val;
    nextProv[provKey] = "ai";
  };

  if (ai.roomTypeId && nextProv["roomTypeId"] !== "human") {
    next.roomTypeId = ai.roomTypeId;
    nextProv["roomTypeId"] = "ai";
  }
  if (ai.designLanguage) setIfNotHuman("designLanguage", "designLanguage", ai.designLanguage);
  if (ai.visualCharacteristics?.length) setIfNotHuman("visualCharacteristics", "visualCharacteristics", ai.visualCharacteristics);
  if (ai.architecturalLanguage) setIfNotHuman("architecturalLanguage", "architecturalLanguage", ai.architecturalLanguage);
  if (ai.designIntent) setIfNotHuman("designIntent", "designIntent", ai.designIntent);

  if (ai.materials && nextProv["materials.flooring"] !== "human") {
    const anyMat = Object.values(ai.materials).some((xs) => xs.length > 0);
    if (anyMat) {
      next.materials = ai.materials;
      for (const k of ["flooring", "walls", "ceiling", "furniture", "surfaces", "other"] as const) {
        if (ai.materials[k].length) nextProv[`materials.${k}`] = "ai";
      }
    }
  }
  if (ai.lighting && nextProv["lighting.artificial"] !== "human") {
    const anyLight = ai.lighting.natural || ai.lighting.artificial || ai.lighting.ambient || ai.lighting.accent || ai.lighting.temperatureK;
    if (anyLight) {
      next.lighting = ai.lighting;
      for (const k of ["natural", "artificial", "ambient", "accent", "temperatureK"] as const) {
        if (ai.lighting[k]) nextProv[`lighting.${k}`] = "ai";
      }
    }
  }
  if (ai.furniture && nextProv["furniture.types"] !== "human") {
    const anyFurn = ai.furniture.types.length || ai.furniture.arrangement || ai.furniture.partitions || ai.furniture.doorsWindows || ai.furniture.composition || ai.furniture.distinctiveElements.length;
    if (anyFurn) {
      next.furniture = ai.furniture;
      for (const k of ["types", "arrangement", "partitions", "doorsWindows", "composition", "distinctiveElements"] as const) {
        const v = ai.furniture[k];
        if (Array.isArray(v) ? v.length > 0 : Boolean(v)) nextProv[`furniture.${k}`] = "ai";
      }
    }
  }
  if (ai.classification) {
    const cls = { ...next.classification };
    if (ai.classification.designCategory && nextProv["classification.designCategory"] !== "human") {
      cls.designCategory = ai.classification.designCategory;
      nextProv["classification.designCategory"] = "ai";
    }
    if (ai.classification.tags.length && nextProv["classification.tags"] !== "human") {
      cls.tags = Array.from(new Set([...cls.tags, ...ai.classification.tags]));
      nextProv["classification.tags"] = "ai";
    }
    if (ai.classification.keywords.length && nextProv["classification.keywords"] !== "human") {
      cls.keywords = Array.from(new Set([...cls.keywords, ...ai.classification.keywords]));
      nextProv["classification.keywords"] = "ai";
    }
    next.classification = cls;
  }
  return { metadata: next, provenance: nextProv };
}

export async function analyseReference(
  referenceId: string,
  actor: string,
  opts: { moodBoardSummary?: string; roomTypes?: RoomType[]; projectName?: string } = {},
): Promise<{ status: "completed" | "failed" | "not_configured"; reference: ReferenceAsset }> {
  const ref = await repo().get("references", referenceId);
  if (!ref) throw notFound("Reference");
  const provider = getVisionProvider();
  if (!provider) return { status: "not_configured", reference: ref };
  const blob = await blobs().get("reference-images", ref.blobKey);
  if (!blob) {
    const failed = await repo().update("references", ref.id, {
      analysis: { ...ref.analysis, provider: provider.id, status: "failed", error: "Image missing from storage.", analysedAt: now() },
      updatedAt: now(),
    });
    return { status: "failed", reference: failed };
  }
  const [roomTypes, project] = await Promise.all([
    opts.roomTypes ? Promise.resolve(opts.roomTypes) : repo().list("roomTypes"),
    opts.projectName ? Promise.resolve(null) : repo().get("projects", ref.projectId),
  ]);

  try {
    const res = await provider.analyse(blob.data, blob.contentType, {
      projectName: opts.projectName ?? project?.name ?? "Project",
      sourceText: ref.sourceText,
      roomTypes,
      moodBoardSummary: opts.moodBoardSummary,
    });
    const merged = mergeAiMetadata(ref.metadata, ref.provenance, res.metadata);
    const updated = await repo().update("references", ref.id, {
      metadata: merged.metadata,
      provenance: merged.provenance,
      analysis: {
        provider: provider.id,
        status: "completed",
        error: null,
        analysedAt: now(),
        imageRole: res.imageRole,
        summary: res.summary,
      },
      updatedAt: now(),
    });
    await audit("reference.ai_analyse", actor, "reference", ref.id, { provider: provider.id, imageRole: res.imageRole, roomTypeId: merged.metadata.roomTypeId });
    return { status: "completed", reference: updated };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI analysis failed.";
    const failed = await repo().update("references", ref.id, {
      analysis: { ...ref.analysis, provider: provider.id, status: "failed", error: msg, analysedAt: now() },
      updatedAt: now(),
    });
    return { status: "failed", reference: failed };
  }
}

export async function analyseReferencesBatch(
  refIds: string[],
  actor: string,
  opts: { moodBoardSummary?: string; concurrency?: number } = {},
) {
  const provider = getVisionProvider();
  if (!provider || !refIds.length) return { completed: 0, failed: 0, skipped: refIds.length };
  const roomTypes = await repo().list("roomTypes");
  const limit = Math.max(1, Math.min(6, opts.concurrency ?? 4));
  let idx = 0;
  let completed = 0;
  let failed = 0;

  async function worker() {
    while (idx < refIds.length) {
      const id = refIds[idx++];
      const res = await analyseReference(id, actor, { roomTypes, moodBoardSummary: opts.moodBoardSummary });
      if (res.status === "completed") completed++;
      else if (res.status === "failed") failed++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, refIds.length) }, () => worker()));
  return { completed, failed, skipped: 0 };
}

async function renderKeyPdfPages(pdfBuf: Buffer, pageNumbers: Array<{ page: number; label: string }>) {
  const pdf = await getDocumentProxy(new Uint8Array(pdfBuf));
  const out: Array<{ page: number; label: string; png: Buffer }> = [];
  try {
    for (const item of pageNumbers) {
      if (item.page < 1 || item.page > pdf.numPages) continue;
      try {
        const vp = (await pdf.getPage(item.page)).getViewport({ scale: 1 });
        const raw = await renderPageAsImage(pdf, item.page, {
          canvasImport: () => import("@napi-rs/canvas"),
          scale: Math.min(4, 1400 / Math.max(vp.width, vp.height)),
        });
        const png = await sharp(Buffer.from(raw)).flatten({ background: "#ffffff" }).png().toBuffer();
        out.push({ page: item.page, label: item.label, png });
      } catch {
        /* page render optional; text still passed */
      }
    }
  } finally {
    await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
  }
  return out;
}

/**
 * Full AI scan for a source document:
 * - For PDFs: reads cover, mood board, and 2D layout + legend; optionally creates a Draft FloorPlan.
 * - For all document kinds: runs Claude Vision on extracted reference images.
 */
export async function scanDocumentWithAi(
  documentId: string,
  actor: string,
  opts: { createFloorPlan?: boolean; analyseImages?: boolean; onlyUnanalysed?: boolean } = {},
) {
  const doc = await repo().get("sourceDocuments", documentId);
  if (!doc) throw notFound("Document");
  const project = await repo().get("projects", doc.projectId);
  if (!project) throw notFound("Project");
  const provider = getVisionProvider();
  if (!provider) return { scanned: false, reason: "ANTHROPIC_API_KEY is not configured.", pdfScan: doc.pdfScan, analysis: { completed: 0, failed: 0, skipped: doc.extractedImageCount } };

  let pdfScan: PdfScanSummary | null = doc.pdfScan ?? null;
  let moodBoardSummary = "";

  if (doc.kind === "pdf") {
    const blob = await blobs().get("source-documents", doc.blobKey);
    if (blob) {
      const moodPage = doc.pageText.find((p) => /\b(mood\s*board|material\s*palette|color\s*palette|colour\s*palette)\b/i.test(p.text))?.page ?? null;
      const layoutGuess = guessPlanPage(doc.pageText);
      const wanted = new Map<number, string>();
      wanted.set(1, "Cover");
      if (layoutGuess) wanted.set(layoutGuess, "Proposed Layout / Floor Plan");
      if (moodPage) wanted.set(moodPage, "Mood Board");
      const pageImages = await renderKeyPdfPages(blob.data, Array.from(wanted, ([page, label]) => ({ page, label })));
      const overview = await scanPdfOverviewWithClaude({ pageImages, pageText: doc.pageText });

      const existingPlan = pdfScan?.floorPlanId ? await repo().get("floorPlans", pdfScan.floorPlanId) : null;
      let floorPlanId: string | null = existingPlan?.id ?? null;
      let floorPlanError: string | null = null;

      const layoutPage = overview.layoutPage;
      if (opts.createFloorPlan !== false && layoutPage && !floorPlanId) {
        try {
          const propName = project.propertyName.trim() || overview.projectDetails.location?.trim() || project.name;
          const existingProps = (await repo().list("properties")).filter((p) => !p.isDemo);
          const matchedProp = existingProps.find((p) => p.name.toLowerCase() === propName.toLowerCase());
          const res = await importPlan({
            fileName: doc.filename,
            data: blob.data,
            propertyId: matchedProp?.id,
            newPropertyName: matchedProp ? undefined : propName,
            city: project.city || overview.projectDetails.location || "",
            page: layoutPage,
            actor,
          });
          floorPlanId = res.plan.id;
        } catch (e) {
          floorPlanError = e instanceof Error ? e.message : "Could not extract 2D floor plan from this PDF.";
        }
      }

      pdfScan = {
        model: overview.model,
        scannedAt: now(),
        projectDetails: overview.projectDetails,
        moodBoard: overview.moodBoard,
        layoutLegend: overview.layoutLegend,
        floorPlanId,
        floorPlanError,
      };
      await repo().update("sourceDocuments", doc.id, { pdfScan });

      if ((!project.city && overview.projectDetails.location) || (!project.propertyName && overview.projectDetails.projectName)) {
        await repo().update("projects", project.id, {
          city: project.city || overview.projectDetails.location || "",
          propertyName: project.propertyName || overview.projectDetails.location || "",
          updatedAt: now(),
        });
      }
      if (pdfScan.moodBoard) {
        moodBoardSummary = [
          pdfScan.moodBoard.styleSummary,
          pdfScan.moodBoard.materialPalette.length ? `Materials: ${pdfScan.moodBoard.materialPalette.join(", ")}` : "",
          pdfScan.moodBoard.colorPalette.length ? `Colours: ${pdfScan.moodBoard.colorPalette.map((c) => c.name).join(", ")}` : "",
        ]
          .filter(Boolean)
          .join(". ");
      }
    }
  }

  let analysis = { completed: 0, failed: 0, skipped: 0 };
  if (opts.analyseImages !== false) {
    const refs = await repo().list("references", { documentId: doc.id });
    const targetIds = (opts.onlyUnanalysed ? refs.filter((r) => r.analysis.status !== "completed") : refs).map((r) => r.id);
    analysis = await analyseReferencesBatch(targetIds, actor, { moodBoardSummary });
  }

  await audit("document.ai_scan", actor, "sourceDocument", doc.id, {
    floorPlanId: pdfScan?.floorPlanId ?? null,
    legendRows: pdfScan?.layoutLegend.length ?? 0,
    analysed: analysis.completed,
    failed: analysis.failed,
  });

  return { scanned: true, pdfScan, analysis };
}
