import "server-only";
import { z } from "zod";
import { audit } from "@/modules/core/audit";
import type { DesignerReview } from "@/modules/core/schemas";
import { AppError, newId, notFound, now } from "@/modules/core/util";
import { repo } from "@/modules/persistence";
import { requireStaff } from "@/modules/security/auth";

export const ReviewInput = z.object({
  sessionId: z.string(),
  roomId: z.string(),
  generatedAssetId: z.string().nullable().default(null),
  action: z.enum(["comment", "approve", "reject", "request_iteration"]),
  comment: z.string().max(4000).default(""),
});

/**
 * Designer review. AI output is never approved automatically: only a designer action
 * marks an image approved, and only approved images become inspiration handoff assets.
 */
export async function recordReview(raw: unknown) {
  const actor = await requireStaff(["admin", "designer"]);
  const input = ReviewInput.parse(raw);
  if (input.action !== "comment" && !input.generatedAssetId) throw new AppError("Choose a generated image to approve, reject or iterate on.");
  if (input.action === "comment" && !input.comment.trim()) throw new AppError("Write a comment first.");
  if (input.generatedAssetId) {
    const asset = await repo().get("generatedAssets", input.generatedAssetId);
    if (!asset || asset.sessionId !== input.sessionId) throw notFound("Generated image");
    if (input.action !== "comment") {
      const status = input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : "iteration_requested";
      await repo().update("generatedAssets", asset.id, { reviewStatus: status, isHandoffAsset: status === "approved", updatedAt: now() });
    }
  }
  const rec: DesignerReview = { id: newId("drv"), ...input, reviewer: actor.label, createdAt: now() };
  await repo().insert("designerReviews", rec);
  await audit(`review.${input.action}`, `staff:${actor.label}`, "designerReview", rec.id, { assetId: input.generatedAssetId });
  return rec;
}

export async function reviewQueue() {
  await requireStaff(["admin", "designer"]);
  const [sessions, selections, assets, reviews, properties] = await Promise.all([
    repo().list("designSessions"),
    repo().list("selections"),
    repo().list("generatedAssets"),
    repo().list("designerReviews"),
    repo().list("properties"),
  ]);
  return sessions
    .map((s) => {
      const a = assets.filter((x) => x.sessionId === s.id);
      return {
        sessionId: s.id,
        clientName: s.clientName,
        propertyName: properties.find((p) => p.id === s.propertyId)?.name ?? "",
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        selectedRooms: selections.filter((x) => x.sessionId === s.id).length,
        generated: a.length,
        awaitingReview: a.filter((x) => x.reviewStatus === "unreviewed").length,
        approved: a.filter((x) => x.reviewStatus === "approved").length,
        lastReviewAt: reviews.filter((r) => r.sessionId === s.id).map((r) => r.createdAt).sort().at(-1) ?? null,
      };
    })
    .filter((s) => s.selectedRooms > 0 || s.generated > 0)
    .sort((a, b) => b.awaitingReview - a.awaitingReview || b.updatedAt.localeCompare(a.updatedAt));
}
