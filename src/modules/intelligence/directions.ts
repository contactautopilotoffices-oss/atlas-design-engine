/**
 * Design direction discovery.
 *
 * Groups references by their reviewed attributes (style words, materials, palette) using
 * deterministic k-medoids on the attribute-similarity distance. Up to `maxGroups` groups;
 * fewer if the data does not support them. Suggestions are named from their most common
 * attributes and always need admin approval: they are proposals, not facts.
 */
import type { ReferenceAsset } from "@/modules/core/schemas";
import { compareReferences, featureSets } from "./similarity";

export type DirectionSuggestion = {
  name: string;
  description: string;
  referenceIds: string[];
  signature: { materials: string[]; keywords: string[]; palette: string[] };
  cohesion: number;
};

const hasEnoughMetadata = (r: ReferenceAsset) => {
  const f = featureSets(r);
  return f.style.length + f.materials.length >= 2;
};

const top = (xs: string[], n: number) => {
  const c = new Map<string, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return Array.from(c.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([k]) => k);
};
const title = (s: string) => s.replace(/\b\w/g, (m) => m.toUpperCase());

export function discoverDirections(all: ReferenceAsset[], maxGroups = 4): { suggestions: DirectionSuggestion[]; usable: number; skipped: number; note: string } {
  const refs = all.filter((r) => r.reviewStatus !== "rejected" && hasEnoughMetadata(r));
  const skipped = all.length - refs.length;
  if (refs.length < 3)
    return { suggestions: [], usable: refs.length, skipped, note: "At least 3 references with style or material metadata are needed. Review more references first." };

  const sim = (a: ReferenceAsset, b: ReferenceAsset) => (a.id === b.id ? 1 : compareReferences(a, b).score);
  const k = Math.min(maxGroups, Math.max(1, Math.floor(refs.length / 2)));
  // deterministic seeding: farthest-point from the most "central" reference
  const centrality = refs.map((r) => refs.reduce((s, o) => s + sim(r, o), 0));
  let medoids = [refs[centrality.indexOf(Math.max(...centrality))]];
  while (medoids.length < k) {
    const far = refs
      .filter((r) => !medoids.includes(r))
      .map((r) => ({ r, d: Math.min(...medoids.map((m) => 1 - sim(r, m))) }))
      .sort((a, b) => b.d - a.d || a.r.id.localeCompare(b.r.id))[0];
    if (!far || far.d < 0.35) break; // data does not support another distinct group
    medoids.push(far.r);
  }
  let groups: ReferenceAsset[][] = [];
  for (let it = 0; it < 8; it++) {
    groups = medoids.map(() => []);
    for (const r of refs) {
      const scores = medoids.map((m) => sim(r, m));
      groups[scores.indexOf(Math.max(...scores))].push(r);
    }
    const next = groups.map((g, gi) =>
      g.length ? g.reduce((best, r) => (g.reduce((s, o) => s + sim(r, o), 0) > g.reduce((s, o) => s + sim(best, o), 0) ? r : best), g[0]) : medoids[gi],
    );
    if (next.every((m, i) => m.id === medoids[i].id)) break;
    medoids = next;
  }

  const suggestions = groups
    .filter((g) => g.length > 0)
    .map((g, gi) => {
      const feats = g.map(featureSets);
      const style = top(feats.flatMap((f) => f.style), 3);
      const materials = top(feats.flatMap((f) => f.materials), 4);
      const palette = top(g.flatMap((r) => r.metadata.colors.palette.slice(0, 2).map((p) => p.hex)), 4);
      const cohesion = g.length > 1 ? g.reduce((s, r) => s + sim(r, medoids[gi]), 0) / g.length : 1;
      const nameParts = style.length ? style.slice(0, 2) : materials.slice(0, 2);
      return {
        name: title(nameParts.join(" & ") || `Direction ${gi + 1}`),
        description: `Suggested from ${g.length} reference(s). Common materials: ${materials.join(", ") || "not recorded"}.`,
        referenceIds: g.map((r) => r.id),
        signature: { materials, keywords: style, palette },
        cohesion: Math.round(cohesion * 100) / 100,
      };
    });
  return { suggestions, usable: refs.length, skipped, note: suggestions.length < maxGroups ? "Fewer groups than the maximum were suggested because the references are not distinct enough to support more." : "" };
}
