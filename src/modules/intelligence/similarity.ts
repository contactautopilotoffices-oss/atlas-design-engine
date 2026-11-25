/**
 * Attribute similarity between references.
 *
 * This is a transparent, deterministic comparison of reviewed metadata and pixel-sampled
 * colours. It is NOT semantic / embedding similarity. Every score comes with the exact
 * shared attributes that produced it. Embedding search (pgvector) plugs in separately once
 * an embedding provider is configured.
 */
import type { ReferenceAsset } from "@/modules/core/schemas";
import { norm, uniq } from "@/modules/core/util";
import { allMaterials } from "@/modules/offerings/eligibility";
import { hexDeltaE } from "./colour";

export const featureSets = (r: ReferenceAsset) => {
  const m = r.metadata;
  return {
    materials: uniq(allMaterials(r).map(norm)),
    furniture: uniq([...m.furniture.types, m.furniture.arrangement ?? ""].filter(Boolean).map(norm)),
    lighting: uniq([m.lighting.natural, m.lighting.artificial, m.lighting.ambient, m.lighting.accent].filter(Boolean).map((x) => norm(x!))),
    style: uniq([m.designLanguage, m.architecturalLanguage, ...m.visualCharacteristics, ...m.classification.tags].filter(Boolean).map((x) => norm(x!))),
  };
};

const jaccard = (a: string[], b: string[]) => {
  if (!a.length && !b.length) return null;
  const sb = new Set(b);
  const inter = a.filter((x) => sb.has(x));
  return { score: inter.length / new Set([...a, ...b]).size, shared: inter };
};

/** Average best-match Delta E between the top-3 palette colours, mapped to 0..1 (0 = far apart). */
export function paletteSimilarity(a: ReferenceAsset, b: ReferenceAsset) {
  const pa = a.metadata.colors.palette.slice(0, 3).map((s) => s.hex);
  const pb = b.metadata.colors.palette.slice(0, 3).map((s) => s.hex);
  if (!pa.length || !pb.length) return null;
  const avg = pa.reduce((s, h) => s + Math.min(...pb.map((k) => hexDeltaE(h, k))), 0) / pa.length;
  return { score: Math.max(0, 1 - avg / 50), avgDeltaE: Math.round(avg * 10) / 10 };
}

const WEIGHTS = { materials: 0.3, furniture: 0.15, lighting: 0.15, style: 0.2, palette: 0.2 };

export type SimilarityResult = {
  referenceId: string;
  score: number;
  basis: string[];
  components: Record<string, number>;
};

export function compareReferences(a: ReferenceAsset, b: ReferenceAsset): SimilarityResult {
  const fa = featureSets(a);
  const fb = featureSets(b);
  const components: Record<string, number> = {};
  const basis: string[] = [];
  let wsum = 0;
  let total = 0;
  for (const key of ["materials", "furniture", "lighting", "style"] as const) {
    const j = jaccard(fa[key], fb[key]);
    if (!j) continue;
    components[key] = Math.round(j.score * 100) / 100;
    total += j.score * WEIGHTS[key];
    wsum += WEIGHTS[key];
    if (j.shared.length) basis.push(`Shared ${key}: ${j.shared.join(", ")}`);
  }
  const pal = paletteSimilarity(a, b);
  if (pal) {
    components.palette = Math.round(pal.score * 100) / 100;
    total += pal.score * WEIGHTS.palette;
    wsum += WEIGHTS.palette;
    basis.push(`Palette distance ${pal.avgDeltaE} (Delta E; under 10 is very close)`);
  }
  if (a.metadata.roomTypeId && a.metadata.roomTypeId === b.metadata.roomTypeId) basis.push("Same room type");
  return { referenceId: b.id, score: wsum ? Math.round((total / wsum) * 100) / 100 : 0, basis, components };
}

export function findSimilar(target: ReferenceAsset, pool: ReferenceAsset[], opts: { crossProjectOnly?: boolean; limit?: number } = {}) {
  return pool
    .filter((r) => r.id !== target.id && (!opts.crossProjectOnly || r.projectId !== target.projectId))
    .map((r) => compareReferences(target, r))
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, opts.limit ?? 12);
}
