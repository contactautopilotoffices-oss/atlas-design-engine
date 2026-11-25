import { route } from "@/modules/core/api";
import { searchReferences } from "@/modules/intelligence/library";
import { currentActor } from "@/modules/security/auth";

export const GET = route(async (req) => {
  const u = new URL(req.url).searchParams;
  const g = (k: string) => u.get(k) || undefined;
  const staff = (await currentActor()).kind === "staff";
  const reviewStatus = g("reviewStatus") as "pending" | "approved" | "rejected" | "needs_review" | undefined;
  return searchReferences({
    q: g("q"),
    roomTypeId: g("roomTypeId"),
    projectId: g("projectId"),
    propertyName: g("propertyName"),
    city: g("city"),
    directionId: g("directionId"),
    material: g("material"),
    characteristic: g("characteristic"),
    colour: g("colour"),
    colourTolerance: g("colourTolerance") ? Number(g("colourTolerance")) : undefined,
    offeringId: g("offeringId"),
    // Clients only ever see approved references; staff can browse everything.
    reviewStatus: staff ? reviewStatus : "approved",
    eligibleOnly: u.get("eligibleOnly") !== "false",
  });
});
