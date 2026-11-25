import "server-only";
/**
 * Roles:
 *  - client:   anyone with a design-session token (browser cookie). Sees only their own sessions.
 *  - designer: staff passcode ATLAS_DESIGNER_PASSCODE. Reviews selections and generated images.
 *  - admin:    staff passcode ATLAS_ADMIN_PASSCODE. Everything, including ingestion and configuration.
 *
 * Staff cookies are HMAC-signed. In local development with no passcodes configured, staff pages
 * are open and a banner says so. In production, staff access requires a configured passcode.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { env, isProduction } from "@/modules/core/env";
import { AppError, randomToken, sha256 } from "@/modules/core/util";
import { dataDir } from "@/modules/persistence";

export type StaffRole = "admin" | "designer";
export type Actor = { kind: "staff"; role: StaffRole; label: string; openDevAccess: boolean } | { kind: "anonymous" };

export const STAFF_COOKIE = "atlas_staff";
export const CLIENT_COOKIE = "atlas_client";

let secretPromise: Promise<string> | null = null;
async function secret() {
  const configured = env().ATLAS_SESSION_SECRET;
  if (configured) return configured;
  if (isProduction()) throw new AppError("ATLAS_SESSION_SECRET must be set in production.", 500, "config");
  secretPromise ??= (async () => {
    const file = path.join(dataDir(), ".session-secret");
    try {
      return (await fs.readFile(file, "utf8")).trim();
    } catch {
      const s = randomToken(32);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, s, { mode: 0o600 });
      return s;
    }
  })();
  return secretPromise;
}

const sign = (payload: string, key: string) => createHmac("sha256", key).update(payload).digest("base64url");
const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

export const staffAuthConfigured = () => Boolean(env().ATLAS_ADMIN_PASSCODE || env().ATLAS_DESIGNER_PASSCODE);

export async function signInStaff(passcode: string): Promise<StaffRole> {
  const e = env();
  let role: StaffRole | null = null;
  if (e.ATLAS_ADMIN_PASSCODE && safeEqual(passcode, e.ATLAS_ADMIN_PASSCODE)) role = "admin";
  else if (e.ATLAS_DESIGNER_PASSCODE && safeEqual(passcode, e.ATLAS_DESIGNER_PASSCODE)) role = "designer";
  if (!role) throw new AppError("That passcode is not recognised.", 401, "unauthorized");
  const exp = Date.now() + 12 * 3600 * 1000;
  const payload = `${role}.${exp}`;
  const value = `${payload}.${sign(payload, await secret())}`;
  (await cookies()).set(STAFF_COOKIE, value, { httpOnly: true, sameSite: "lax", secure: isProduction(), path: "/", maxAge: 12 * 3600 });
  return role;
}

export async function signOutStaff() {
  (await cookies()).delete(STAFF_COOKIE);
}

export async function currentActor(): Promise<Actor> {
  if (!staffAuthConfigured() && !isProduction())
    return { kind: "staff", role: "admin", label: "local-dev (no passcode set)", openDevAccess: true };
  const raw = (await cookies()).get(STAFF_COOKIE)?.value;
  if (!raw) return { kind: "anonymous" };
  const [role, exp, sig] = raw.split(".");
  if (!role || !exp || !sig) return { kind: "anonymous" };
  if (!safeEqual(sig, sign(`${role}.${exp}`, await secret())) || Number(exp) < Date.now()) return { kind: "anonymous" };
  if (role !== "admin" && role !== "designer") return { kind: "anonymous" };
  return { kind: "staff", role, label: role, openDevAccess: false };
}

export async function requireStaff(roles: StaffRole[] = ["admin", "designer"]) {
  const a = await currentActor();
  if (a.kind !== "staff") throw new AppError("Staff sign-in required.", 401, "unauthorized");
  if (!roles.includes(a.role)) throw new AppError("Your role cannot perform this action.", 403, "forbidden");
  return a;
}

/** The client's private session token lives only in an httpOnly cookie; we store its hash. */
export async function clientTokenHash(create = false): Promise<string | null> {
  const jar = await cookies();
  let token = jar.get(CLIENT_COOKIE)?.value;
  if (!token && create) {
    token = randomToken(24);
    jar.set(CLIENT_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: isProduction(), path: "/", maxAge: 60 * 60 * 24 * 90 });
  }
  return token ? sha256(token) : null;
}

export const actorLabel = (a: Actor) => (a.kind === "staff" ? `staff:${a.label}` : "client");
