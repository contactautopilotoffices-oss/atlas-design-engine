import { route } from "@/modules/core/api";
import { listJobs } from "@/modules/generation/orchestrator";
import { requireStaff } from "@/modules/security/auth";

export const GET = route(async () => {
  await requireStaff();
  return { jobs: await listJobs() };
});
