import { route } from "@/modules/core/api";
import { deleteGeneratedAsset } from "@/modules/generation/orchestrator";

export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  await deleteGeneratedAsset(id);
  return { ok: true };
});
