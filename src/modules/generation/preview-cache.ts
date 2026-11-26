import "server-only";
/**
 * Materializes a pre-generated FloorPlanPreview into a specific DesignSession's
 * generatedAssets + generationJobs without making a redundant AI provider call.
 */
import type { FloorPlanPreview, GeneratedAsset, GenerationJob } from "@/modules/core/schemas";
import { newId, now, randomToken } from "@/modules/core/util";
import { blobs, repo } from "@/modules/persistence";

export async function materializePlanPreviewToSession(sessionId: string, preview: FloorPlanPreview): Promise<GeneratedAsset | null> {
  const existing = (await repo().list("generatedAssets", { sessionId })).find(
    (a) => a.roomId === preview.roomId && a.tierOfferingId === preview.tierOfferingId && a.reviewStatus !== "rejected",
  );
  if (existing) return existing;
  const blob = await blobs().get("floor-plans", preview.blobKey);
  if (!blob) return null;

  const t = now();
  const jobId = newId("job");
  const ext = blob.contentType.includes("jpeg") || blob.contentType.includes("jpg") ? "jpg" : blob.contentType.includes("webp") ? "webp" : "png";
  const asset: GeneratedAsset = {
    id: newId("gen"),
    jobId,
    sessionId,
    roomId: preview.roomId,
    tierOfferingId: preview.tierOfferingId,
    blobKey: `${sessionId}/${jobId}-0.${ext}`,
    providerUrl: null,
    mimeType: blob.contentType,
    reviewStatus: "unreviewed",
    isHandoffAsset: false,
    createdAt: t,
    updatedAt: t,
  };
  await blobs().put("generated-images", asset.blobKey, blob.data, blob.contentType);
  const job: GenerationJob = {
    id: jobId,
    batchId: newId("batch"),
    sessionId,
    roomId: preview.roomId,
    status: "completed",
    modelId: preview.modelId,
    settings: { cachedPreviewId: preview.id },
    brief: {
      roomTypeName: "",
      intendedUse: "",
      occupancy: 0,
      designObjective: "",
      designDirection: null,
      dimensions: { length: 0, width: 0, height: 0, unit: "m" },
      doors: [],
      windows: [],
      fixedConstraints: [],
      colours: { primary: null, secondary: null, tertiary: null },
      materials: [],
      lighting: [],
      furniture: [],
      references: [{ referenceId: preview.referenceId, referenceCode: "", projectName: "", role: "primary" }],
    },
    prompt: "Cached floor-plan tier preview",
    negativePrompt: "",
    referenceInputs: [{ referenceId: preview.referenceId, role: "primary", kind: "reference", providerUrl: null }],
    refinementOfAssetId: null,
    tierOfferingId: preview.tierOfferingId,
    idempotencyKey: `cached-${preview.id}-${randomToken(8)}`,
    providerRequestId: null,
    providerStatusUrl: null,
    providerCancelUrl: null,
    providerRawStatus: "cached",
    attempts: 0,
    nextPollAt: null,
    error: null,
    costNote: "Reused pre-generated floor-plan preview (zero extra AI charge).",
    outputAssetIds: [asset.id],
    createdBy: "system",
    createdAt: t,
    updatedAt: t,
    submittedAt: t,
    completedAt: t,
  };
  await repo().insert("generationJobs", job);
  await repo().insert("generatedAssets", asset);
  return asset;
}
