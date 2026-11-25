import { route } from "@/modules/core/api";
import { loadDemoContent, removeDemoContent } from "@/modules/core/demo";
import { requireStaff } from "@/modules/security/auth";

export const POST = route(async () => {
  const a = await requireStaff(["admin"]);
  return loadDemoContent(`staff:${a.label}`);
});
export const DELETE = route(async () => {
  const a = await requireStaff(["admin"]);
  return removeDemoContent(`staff:${a.label}`);
});
