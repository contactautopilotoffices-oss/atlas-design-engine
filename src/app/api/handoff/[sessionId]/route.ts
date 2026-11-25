import { readJson, route } from "@/modules/core/api";
import { emailStatus } from "@/modules/handoff/email";
import { handoffSummary, sendHandoffEmail } from "@/modules/handoff/summary";

export const GET = route<{ sessionId: string }>(async (_req, { sessionId }) => ({ ...(await handoffSummary(sessionId)), email: emailStatus() }));
export const POST = route<{ sessionId: string }>(async (req, { sessionId }) => sendHandoffEmail(sessionId, await readJson(req), new URL(req.url).origin));
