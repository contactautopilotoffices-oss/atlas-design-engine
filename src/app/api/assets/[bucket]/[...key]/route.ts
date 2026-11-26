import { route } from "@/modules/core/api";
import { forbidden, notFound } from "@/modules/core/util";
import { blobs, repo } from "@/modules/persistence";
import type { BlobBucket } from "@/modules/persistence/types";
import { clientTokenHash, currentActor } from "@/modules/security/auth";

const BUCKETS: BlobBucket[] = ["source-documents", "reference-images", "reference-thumbnails", "floor-plans", "generated-images", "supporting-assets"];

/**
 * Streams stored files with access control. Nothing is public:
 * - source documents and supporting files: staff only
 * - reference images/thumbnails: staff, or anyone for APPROVED references
 * - generated images: staff, or the browser that owns the design session
 * - floor-plan drawings: staff, or anyone once the plan is published
 */
export const GET = route<{ bucket: string; key: string[] }>(async (_req, { bucket, key }) => {
  if (!BUCKETS.includes(bucket as BlobBucket)) throw notFound("File");
  const path = key.join("/");
  const staff = (await currentActor()).kind === "staff";
  if (!staff) {
    if (bucket === "reference-images" || bucket === "reference-thumbnails") {
      const refId = key.at(-1)!.replace(/\.[a-z]+$/i, "");
      const ref = await repo().get("references", refId);
      if (!ref || ref.reviewStatus !== "approved") throw forbidden();
    } else if (bucket === "generated-images") {
      const session = await repo().get("designSessions", key[0]);
      const hash = await clientTokenHash(false);
      if (!session || !hash || session.ownerTokenHash !== hash) throw forbidden();
    } else if (bucket === "floor-plans") {
      // The drawing and cached tier previews under a published plan are shown to clients; drafts stay staff-only.
      const plan = await repo().get("floorPlans", key[0]);
      const allowed = plan && plan.status !== "draft" && (plan.background?.key === path || (plan.previews ?? []).some((p) => p.blobKey === path));
      if (!allowed) throw forbidden();
    } else throw forbidden();
  }
  const file = await blobs().get(bucket as BlobBucket, path);
  if (!file) throw notFound("File");
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      ...(bucket === "source-documents" ? { "Content-Disposition": `attachment; filename="${path.split("/").pop()}"` } : {}),
    },
  });
});
