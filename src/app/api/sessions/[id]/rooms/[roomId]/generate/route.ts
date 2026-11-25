import { readJson, route } from "@/modules/core/api";
import { createGeneration, listJobs } from "@/modules/generation/orchestrator";
import { getAuthorisedSession } from "@/modules/selections/service";

export const maxDuration = 120;

export const GET = route<{ id: string; roomId: string }>(async (_req, { id, roomId }) => {
  await getAuthorisedSession(id);
  return { jobs: await listJobs({ sessionId: id, roomId }) };
});

/** Starts paid generation. Requires { confirmed: true } in the body. */
export const POST = route<{ id: string; roomId: string }>(async (req, { id, roomId }) => createGeneration(id, roomId, await readJson(req)));
