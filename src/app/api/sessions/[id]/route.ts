import { z } from "zod";
import { readJson, route } from "@/modules/core/api";
import { deleteSession, sessionSummary, setSessionOffering } from "@/modules/selections/service";

export const GET = route<{ id: string }>(async (_req, { id }) => sessionSummary(id));

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const { offeringId } = z.object({ offeringId: z.string() }).parse(await readJson(req));
  await setSessionOffering(id, offeringId);
  return sessionSummary(id);
});

export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  await deleteSession(id);
  return { ok: true };
});
