import { route } from "@/modules/core/api";
import { portfolioIntelligence } from "@/modules/intelligence/library";
import { requireStaff } from "@/modules/security/auth";

export const GET = route(async () => {
  await requireStaff();
  return portfolioIntelligence();
});
