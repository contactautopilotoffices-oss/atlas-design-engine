import { route } from "@/modules/core/api";
import { cancelJob } from "@/modules/generation/orchestrator";

export const POST = route<{ id: string }>(async (_req, { id }) => cancelJob(id));
