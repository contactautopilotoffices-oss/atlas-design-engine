import { route } from "@/modules/core/api";
import { analyseReference } from "@/modules/analysis/scanner";
import { getReferenceView } from "@/modules/intelligence/library";
import { requireStaff } from "@/modules/security/auth";

export const maxDuration = 120;

export const POST = route<{ id: string }>(async (_req, { id }) => {
  const a = await requireStaff(["admin", "designer"]);
  const res = await analyseReference(id, `staff:${a.label}`);
  return { status: res.status, ...(await getReferenceView(id)) };
});
