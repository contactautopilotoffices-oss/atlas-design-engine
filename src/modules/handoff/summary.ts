import "server-only";
import { z } from "zod";
import { audit } from "@/modules/core/audit";
import { AppError } from "@/modules/core/util";
import { rateLimit } from "@/modules/security/rate-limit";
import { requireStaff } from "@/modules/security/auth";
import { sessionSummary } from "@/modules/selections/service";
import { emailProvider } from "./email";

export async function handoffSummary(sessionId: string) {
  const s = await sessionSummary(sessionId);
  const rooms = s.rooms
    .filter((r) => r.selection)
    .map((r) => ({
      roomId: r.room.id,
      roomName: r.room.name,
      roomCode: r.room.code,
      roomTypeName: r.roomTypeName,
      reference: r.selection!.reference,
      chosenAiImageUrl: r.selection!.generatedImageUrl,
      revision: r.selection!.revision,
      offeringName: r.selection!.offeringName,
      selectedBoq: r.selectedBoq,
      dimensions: r.spec ? { length: r.spec.spec.length, width: r.spec.spec.width, height: r.spec.spec.height, unit: r.spec.spec.unit, valid: r.spec.isValid } : null,
      generated: r.assets.map((a) => ({ id: a.id, url: `/api/assets/generated-images/${a.blobKey}`, reviewStatus: a.reviewStatus, isHandoffAsset: a.isHandoffAsset })),
      approvedImages: r.assets.filter((a) => a.isHandoffAsset).map((a) => `/api/assets/generated-images/${a.blobKey}`),
      latestDesignerNote: r.reviews.find((x) => x.comment)?.comment ?? null,
    }));
  return {
    session: s.session,
    property: s.property,
    offering: s.offering,
    currency: s.currency,
    boqSummary: s.boqSummary,
    floorPlanIsSample: s.floorPlan?.isSample ?? false,
    rooms,
    designerApproval: rooms.length && rooms.every((r) => r.approvedImages.length > 0) ? "all rooms have approved images" : "pending",
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function sendHandoffEmail(sessionId: string, raw: unknown, origin: string) {
  await requireStaff(["admin", "designer"]);
  const { to } = z.object({ to: z.string().email() }).parse(raw);
  const provider = emailProvider();
  if (!provider) throw new AppError("Email sending is not configured, so nothing was sent.", 503, "email_not_configured");
  rateLimit(`email:${sessionId}`, 3, 60 * 60_000);
  const h = await handoffSummary(sessionId);
  const link = `${origin}/handoff/${sessionId}`;
  const lines = h.rooms.map((r) => `${r.roomName}: ${r.reference?.referenceCode ?? ""} from ${r.reference?.project.name ?? ""} (revision ${r.revision})`);
  const res = await provider.send({
    to,
    subject: `Your design selections: ${h.property?.name ?? "ATLAS"}`,
    text: `Selections\n${lines.join("\n")}\n\nFull summary: ${link}`,
    html: `<h2>Your design selections</h2><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p><a href="${esc(link)}">Open the full summary</a></p>`,
  });
  await audit("handoff.email", "staff", "designSession", sessionId, { providerMessageId: res.providerMessageId });
  return { sent: true, providerMessageId: res.providerMessageId };
}
