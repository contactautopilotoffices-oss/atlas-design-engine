import { z } from "zod";
import { readJson, route } from "@/modules/core/api";
import { analyseReferencesBatch } from "@/modules/analysis/scanner";
import { visionStatus } from "@/modules/analysis/vision";
import { AppError } from "@/modules/core/util";
import { repo } from "@/modules/persistence";
import { requireStaff } from "@/modules/security/auth";

export const maxDuration = 300;

export const POST = route(async (req) => {
  const a = await requireStaff(["admin", "designer"]);
  if (!visionStatus().configured) throw new AppError(visionStatus().reason ?? "AI analysis is not configured.", 503, "not_configured");
  const { projectId, onlyUnanalysed, reviewStatus } = z
    .object({
      projectId: z.string().optional(),
      onlyUnanalysed: z.boolean().default(true),
      reviewStatus: z.string().optional(),
    })
    .default({ onlyUnanalysed: true })
    .parse(await readJson(req).catch(() => ({})));
  const refs = await repo().list("references", projectId ? { projectId } : undefined);
  const filtered = refs.filter(
    (r) =>
      (!reviewStatus || r.reviewStatus === reviewStatus) &&
      (!onlyUnanalysed || r.analysis.status !== "completed"),
  );
  return analyseReferencesBatch(
    filtered.map((r) => r.id),
    `staff:${a.label}`,
  );
});
