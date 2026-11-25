import { route } from "@/modules/core/api";
import { repo } from "@/modules/persistence";
import { requireStaff } from "@/modules/security/auth";

export const GET = route(async () => {
  await requireStaff(["admin"]);
  return { entries: (await repo().list("auditLog")).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 300) };
});
