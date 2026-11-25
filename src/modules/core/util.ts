import { createHash, randomBytes, randomUUID } from "node:crypto";

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
export const now = () => new Date().toISOString();
export const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const formatReferenceCode = (n: number) => `REF-${String(n).padStart(5, "0")}`;

/** An error whose message is safe to show to the user, with an HTTP status. */
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "bad_request",
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(`${what} was not found.`, 404, "not_found");
export const forbidden = (msg = "You do not have access to this resource.") => new AppError(msg, 403, "forbidden");

export const uniq = <T>(xs: T[]) => Array.from(new Set(xs));
export const norm = (s: string) => s.trim().toLowerCase();
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
