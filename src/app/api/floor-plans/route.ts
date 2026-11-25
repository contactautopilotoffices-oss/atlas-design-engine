import { route } from "@/modules/core/api";
import { env } from "@/modules/core/env";
import { AppError } from "@/modules/core/util";
import { planReaderStatus } from "@/modules/floorplans/claude";
import { importPlan, listPlans } from "@/modules/floorplans/service";
import { requireStaff } from "@/modules/security/auth";
import { rateLimit } from "@/modules/security/rate-limit";

export const maxDuration = 300;

export const GET = route(async () => {
  await requireStaff(["admin", "designer"]);
  const reader = planReaderStatus();
  return { plans: await listPlans(), reader: reader.configured ? { configured: true, model: reader.model } : reader };
});

/** Multipart: file, and either propertyId or newPropertyName (+ city). Optional page for PDFs. */
export const POST = route(async (req) => {
  const a = await requireStaff(["admin"]);
  rateLimit(`plan-import:${a.label}`, 20, 10 * 60_000);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > env().ATLAS_MAX_UPLOAD_MB * 1024 * 1024 * 1.1) throw new AppError("This file is too large.", 413);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !file || typeof file !== "object" || !("arrayBuffer" in file)) throw new AppError("Attach the floor plan file.");
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const page = str("page") ? Number(str("page")) : null;
  if (page !== null && !(Number.isInteger(page) && page > 0)) throw new AppError("Page must be a whole number.");
  return importPlan({
    fileName: (file as File).name.slice(0, 200),
    data: Buffer.from(await (file as File).arrayBuffer()),
    propertyId: str("propertyId"),
    newPropertyName: str("newPropertyName"),
    city: str("city"),
    page,
    actor: `staff:${a.label}`,
  });
});
