import "server-only";
import { connection } from "next/server";
import { ZodError } from "zod";
import { ensureBootstrapped } from "./bootstrap";
import { AppError } from "./util";

type Ctx<P> = { params: Promise<P> };

/** Wraps a route handler: request-time only, bootstrapped store, safe JSON errors, no secret leakage. */
export function route<P = Record<string, string>>(fn: (req: Request, params: P) => Promise<Response | unknown>) {
  return async (req: Request, ctx: Ctx<P>) => {
    await connection();
    try {
      await ensureBootstrapped();
      const out = await fn(req, (await ctx.params) ?? ({} as P));
      return out instanceof Response ? out : Response.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof AppError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
      if (e instanceof ZodError)
        return Response.json(
          { error: "Some fields are invalid.", code: "validation", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
          { status: 400 },
        );
      console.error("[atlas] unhandled error:", e instanceof Error ? e.message : "unknown");
      return Response.json({ error: "Something went wrong on the server.", code: "internal" }, { status: 500 });
    }
  };
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new AppError("Request body must be JSON.", 400);
  }
}
