import { z } from "zod";
import { readJson, route } from "@/modules/core/api";
import { rateLimit } from "@/modules/security/rate-limit";
import { mySessions, startSession } from "@/modules/selections/service";

export const GET = route(async () => ({ sessions: (await mySessions()).map((s) => ({ ...s, ownerTokenHash: undefined })) }));

export const POST = route(async (req) => {
  rateLimit(`session:${req.headers.get("x-forwarded-for") ?? "local"}`, 30, 60 * 60_000);
  const input = z.object({ propertyId: z.string(), floorPlanId: z.string(), offeringId: z.string(), clientName: z.string().max(200).optional() }).parse(await readJson(req));
  const s = await startSession(input);
  return { session: { ...s, ownerTokenHash: undefined } };
});
