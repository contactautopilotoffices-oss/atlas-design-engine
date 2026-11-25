/** Offering eligibility. Pure business logic driven entirely by Offering.rules (configured in Admin). */
import type { Offering, ReferenceAsset } from "@/modules/core/schemas";
import { norm } from "@/modules/core/util";

export const allMaterials = (r: Pick<ReferenceAsset, "metadata">) => {
  const m = r.metadata.materials;
  return [...m.flooring, ...m.walls, ...m.ceiling, ...m.furniture, ...m.surfaces, ...m.other];
};

export function checkEligibility(ref: ReferenceAsset, offering: Offering, all: Offering[]): { eligible: boolean; reasons: string[] } {
  const r = offering.rules;
  const reasons: string[] = [];
  if (r.excludeReferenceIds.includes(ref.id)) return { eligible: false, reasons: ["Explicitly excluded from this offering."] };
  const explicitlyIncluded = r.includeReferenceIds.includes(ref.id);
  if (!explicitlyIncluded) {
    if (r.requireApproved && ref.reviewStatus !== "approved") reasons.push("Not yet approved by the review team.");
    if (ref.reviewStatus === "rejected") reasons.push("Rejected in review.");
    if (r.roomTypeIds.length && (!ref.metadata.roomTypeId || !r.roomTypeIds.includes(ref.metadata.roomTypeId)))
      reasons.push("Room type is not part of this offering.");
    if (r.mode === "tagged") {
      const tagged = ref.metadata.classification.offeringIds;
      const allowedIds = new Set([offering.id]);
      if (r.inheritLowerTiers) for (const o of all) if (o.rank < offering.rank) allowedIds.add(o.id);
      if (!tagged.some((t) => allowedIds.has(t))) reasons.push("Not tagged for this offering.");
    }
    const excluded = new Set(r.excludedMaterialNames.map(norm));
    const blocked = allMaterials(ref).filter((m) => excluded.has(norm(m)));
    if (blocked.length) reasons.push(`Uses materials not included in this offering: ${Array.from(new Set(blocked)).join(", ")}.`);
  }
  return { eligible: reasons.length === 0, reasons };
}
