import { z } from "zod";
import { readJson, route } from "@/modules/core/api";
import { audit } from "@/modules/core/audit";
import { currentActor, signInStaff, signOutStaff } from "@/modules/security/auth";
import { rateLimit } from "@/modules/security/rate-limit";

export const GET = route(async () => {
  const a = await currentActor();
  return a.kind === "staff" ? { signedIn: true, role: a.role, openDevAccess: a.openDevAccess } : { signedIn: false };
});

export const POST = route(async (req) => {
  rateLimit(`login:${req.headers.get("x-forwarded-for") ?? "local"}`, 10, 15 * 60_000);
  const { passcode } = z.object({ passcode: z.string().min(1).max(200) }).parse(await readJson(req));
  const role = await signInStaff(passcode);
  await audit("staff.signin", `staff:${role}`, "staff", null);
  return { signedIn: true, role };
});

export const DELETE = route(async () => {
  await signOutStaff();
  return { signedIn: false };
});
