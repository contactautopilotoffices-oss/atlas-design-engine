/** Portfolio-level pattern discovery: recurring combinations and project-unique traits. Pure. */
import type { ReferenceAsset } from "@/modules/core/schemas";
import { featureSets } from "./similarity";

export type Pattern = { label: string; kind: string; projects: string[]; referenceIds: string[] };

export function recurringPatterns(refs: ReferenceAsset[], minProjects = 2): Pattern[] {
  const pairs = new Map<string, { projects: Set<string>; refs: Set<string>; kind: string; label: string }>();
  const add = (key: string, kind: string, label: string, r: ReferenceAsset) => {
    const e = pairs.get(key) ?? { projects: new Set(), refs: new Set(), kind, label };
    e.projects.add(r.projectId);
    e.refs.add(r.id);
    pairs.set(key, e);
  };
  for (const r of refs) {
    const f = featureSets(r);
    const mats = [...f.materials].sort();
    for (let i = 0; i < mats.length; i++)
      for (let j = i + 1; j < mats.length; j++) add(`mat:${mats[i]}|${mats[j]}`, "material combination", `${mats[i]} + ${mats[j]}`, r);
    for (const l of f.lighting) add(`light:${l}`, "lighting approach", l, r);
    for (const fu of f.furniture) add(`furn:${fu}`, "furniture / arrangement", fu, r);
    for (const s of f.style) add(`style:${s}`, "design language", s, r);
  }
  return Array.from(pairs.values())
    .filter((e) => e.projects.size >= minProjects)
    .map((e) => ({ label: e.label, kind: e.kind, projects: Array.from(e.projects), referenceIds: Array.from(e.refs) }))
    .sort((a, b) => b.projects.length - a.projects.length || b.referenceIds.length - a.referenceIds.length);
}

/** Attributes that appear in exactly one project. */
export function uniqueCharacteristics(refs: ReferenceAsset[]): Array<{ projectId: string; traits: Array<{ kind: string; value: string; referenceIds: string[] }> }> {
  const owners = new Map<string, { projects: Set<string>; refs: string[]; kind: string; value: string }>();
  for (const r of refs) {
    const f = featureSets(r);
    for (const [kind, values] of Object.entries(f))
      for (const v of values) {
        const key = `${kind}:${v}`;
        const e = owners.get(key) ?? { projects: new Set(), refs: [], kind, value: v };
        e.projects.add(r.projectId);
        e.refs.push(r.id);
        owners.set(key, e);
      }
  }
  const byProject = new Map<string, Array<{ kind: string; value: string; referenceIds: string[] }>>();
  for (const e of owners.values()) {
    if (e.projects.size !== 1) continue;
    const pid = Array.from(e.projects)[0];
    const list = byProject.get(pid) ?? [];
    list.push({ kind: e.kind, value: e.value, referenceIds: e.refs });
    byProject.set(pid, list);
  }
  return Array.from(byProject.entries()).map(([projectId, traits]) => ({ projectId, traits }));
}
