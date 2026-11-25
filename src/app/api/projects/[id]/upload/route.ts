import { route } from "@/modules/core/api";
import { scanDocumentWithAi } from "@/modules/analysis/scanner";
import { visionStatus } from "@/modules/analysis/vision";
import { env } from "@/modules/core/env";
import { AppError } from "@/modules/core/util";
import { ingestFile } from "@/modules/ingestion/service";
import { requireStaff } from "@/modules/security/auth";
import { rateLimit } from "@/modules/security/rate-limit";

export const maxDuration = 300;

/** Multipart upload: field "files" (one or more). Optional field "autoScan" ("true" | "false"). */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const a = await requireStaff(["admin"]);
  rateLimit(`upload:${a.label}`, 40, 10 * 60_000);
  const len = Number(req.headers.get("content-length") ?? 0);
  const max = env().ATLAS_MAX_UPLOAD_MB * 1024 * 1024;
  if (len > max * 5) throw new AppError("Upload is too large. Send fewer files at once.", 413);
  const form = await req.formData().catch(() => null);
  if (!form) throw new AppError("Expected a multipart form upload.");
  const files = form.getAll("files").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f);
  if (!files.length) throw new AppError("No files were attached.");
  const wantScan = form.get("autoScan") !== "false" && visionStatus().configured;
  const results = [];
  for (const f of files) {
    try {
      const actor = `staff:${a.label}`;
      const r = await ingestFile({ projectId: id, filename: f.name.slice(0, 200), data: Buffer.from(await f.arrayBuffer()), actor });
      let aiScan: Awaited<ReturnType<typeof scanDocumentWithAi>> | null = null;
      let aiScanError: string | null = null;
      if (wantScan && r.document.status !== "failed" && !r.alreadyProcessed) {
        try {
          aiScan = await scanDocumentWithAi(r.document.id, actor, { createFloorPlan: r.document.kind === "pdf", analyseImages: true });
        } catch (se) {
          aiScanError = se instanceof Error ? se.message : "AI scan failed.";
        }
      }
      results.push({
        filename: f.name,
        ok: r.document.status !== "failed",
        status: r.document.status,
        alreadyProcessed: r.alreadyProcessed,
        createdReferences: r.createdReferences,
        duplicateImages: r.duplicateImages,
        errors: r.document.errors,
        documentId: r.document.id,
        aiScan,
        aiScanError,
      });
    } catch (e) {
      results.push({ filename: f.name, ok: false, status: "rejected", error: e instanceof AppError ? e.message : "Could not process this file." });
    }
  }
  return { results };
});
