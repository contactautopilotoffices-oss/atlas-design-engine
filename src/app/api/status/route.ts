import { route } from "@/modules/core/api";
import { systemStatus } from "@/modules/core/status";
import { currentActor } from "@/modules/security/auth";

export const GET = route(async () => {
  const actor = await currentActor();
  return { ...systemStatus(), actor: actor.kind === "staff" ? { role: actor.role, openDevAccess: actor.openDevAccess } : null };
});
