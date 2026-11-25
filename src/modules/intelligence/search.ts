/** Text and attribute search over the reference library. Pure functions. */
import type { ReferenceAsset } from "@/modules/core/schemas";
import { norm } from "@/modules/core/util";
import { allMaterials } from "@/modules/offerings/eligibility";
import { hexDeltaE } from "./colour";

export type ReferenceFilters = {
  q?: string;
  roomTypeId?: string;
  projectId?: string;
  propertyName?: string;
  city?: string;
  directionId?: string;
  material?: string;
  characteristic?: string;
  colour?: string;
  /** Max CIE76 Delta E for a colour match. ~10 = clearly similar, ~20 = same family. */
  colourTolerance?: number;
  reviewStatus?: ReferenceAsset["reviewStatus"];
};

export type ProjectLite = { id: string; name: string; propertyName: string; city: string };

export function searchableText(r: ReferenceAsset, p?: ProjectLite) {
  const m = r.metadata;
  return [
    r.referenceCode,
    p?.name,
    p?.propertyName,
    p?.city,
    r.sourceFilename,
    r.sourceText,
    m.designLanguage,
    m.architecturalLanguage,
    m.designIntent,
    ...m.visualCharacteristics,
    ...allMaterials(r),
    m.lighting.natural,
    m.lighting.artificial,
    m.lighting.ambient,
    m.lighting.accent,
    ...m.furniture.types,
    m.furniture.arrangement,
    ...m.furniture.distinctiveElements,
    m.classification.designCategory,
    ...m.classification.tags,
    ...m.classification.keywords,
    m.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function matchesFilters(r: ReferenceAsset, f: ReferenceFilters, p?: ProjectLite): boolean {
  const m = r.metadata;
  if (f.roomTypeId && m.roomTypeId !== f.roomTypeId) return false;
  if (f.projectId && r.projectId !== f.projectId) return false;
  if (f.propertyName && norm(p?.propertyName ?? "") !== norm(f.propertyName)) return false;
  if (f.city && norm(p?.city ?? "") !== norm(f.city)) return false;
  if (f.directionId && m.designDirectionId !== f.directionId) return false;
  if (f.reviewStatus && r.reviewStatus !== f.reviewStatus) return false;
  if (f.material && !allMaterials(r).some((x) => norm(x) === norm(f.material!))) return false;
  if (f.characteristic) {
    const c = norm(f.characteristic);
    const pool = [...m.visualCharacteristics, ...m.classification.tags, ...m.furniture.distinctiveElements].map(norm);
    if (!pool.includes(c)) return false;
  }
  if (f.colour && /^#[0-9a-f]{6}$/i.test(f.colour)) {
    const tol = f.colourTolerance ?? 15;
    const pal = [m.colors.primary, m.colors.secondary, m.colors.tertiary, ...m.colors.palette.map((s) => s.hex)].filter(Boolean) as string[];
    if (!pal.some((h) => hexDeltaE(h, f.colour!) <= tol)) return false;
  }
  if (f.q) {
    const hay = searchableText(r, p);
    const terms = norm(f.q).split(/\s+/).filter(Boolean);
    if (!terms.every((t) => hay.includes(t))) return false;
  }
  return true;
}
