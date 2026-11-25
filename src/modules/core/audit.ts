import "server-only";
import { repo } from "@/modules/persistence";
import { newId, now } from "./util";

/** Records important actions. Never pass secrets in details. */
export async function audit(action: string, actor: string, entity: string, entityId: string | null, details: Record<string, unknown> = {}) {
  try {
    await repo().insert("auditLog", { id: newId("aud"), action, actor, entity, entityId, details, at: now() });
  } catch {
    // Auditing must never break the user-facing action.
  }
}
