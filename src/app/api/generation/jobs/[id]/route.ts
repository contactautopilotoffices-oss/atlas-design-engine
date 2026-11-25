import { route } from "@/modules/core/api";
import { deleteGenerationJob, refreshJob } from "@/modules/generation/orchestrator";
import { repo } from "@/modules/persistence";

/** Returns the job, polling Higgsfield if it is due. The browser calls this every few seconds. */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  const job = await refreshJob(id);
  const assets = await Promise.all(job.outputAssetIds.map((a) => repo().get("generatedAssets", a)));
  return { job, assets: assets.filter(Boolean).map((a) => ({ ...a!, url: `/api/assets/generated-images/${a!.blobKey}` })) };
});

export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  await deleteGenerationJob(id);
  return { ok: true };
});
