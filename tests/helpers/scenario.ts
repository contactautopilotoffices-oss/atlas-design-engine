import { ensureBootstrapped } from "@/modules/core/bootstrap";
import { ReferenceMetadata } from "@/modules/core/schemas";
import { createProject, ingestFile } from "@/modules/ingestion/service";
import { updateReference } from "@/modules/intelligence/library";
import { repo } from "@/modules/persistence";
import { testPng } from "./env";

type Spec = { project: string; room: string; base: string; accent: string; materials: string[]; style: string; lighting?: string; furniture?: string[] };

/** Builds a small approved library across projects through the real ingestion + review services. */
export async function seedLibrary(specs: Spec[]) {
  await ensureBootstrapped();
  const projects = new Map<string, string>();
  const ids: string[] = [];
  for (const [i, s] of specs.entries()) {
    if (!projects.has(s.project)) projects.set(s.project, (await createProject({ name: s.project, clientName: "", propertyName: `${s.project} Tower`, city: "Mumbai", category: "Office" }, "test")).id);
    const res = await ingestFile({ projectId: projects.get(s.project)!, filename: `${s.project}-${i}.png`, data: await testPng(s.base, s.accent, 400, 300, String(i)), actor: "test" });
    const ref = (await repo().list("references", { documentId: res.document.id }))[0];
    const md = ReferenceMetadata.parse({
      ...ref.metadata,
      roomTypeId: s.room,
      designLanguage: s.style,
      materials: { flooring: [s.materials[0]], walls: [], ceiling: [], furniture: s.materials.slice(1), surfaces: [], other: [] },
      lighting: { natural: null, artificial: s.lighting ?? null, ambient: null, accent: null, temperatureK: null },
      furniture: { types: s.furniture ?? [], arrangement: null, partitions: null, doorsWindows: null, composition: null, distinctiveElements: [] },
    });
    await updateReference(ref.id, { metadata: md, reviewStatus: "approved" }, "test");
    ids.push(ref.id);
  }
  return { ids, projects };
}

export const LIB = [
  { project: "Volt", room: "rt_meeting", base: "#E8E1D6", accent: "#6F573E", materials: ["Natural Wood", "Glass"], style: "Modern Minimal", lighting: "Warm ambient", furniture: ["Meeting Table"] },
  { project: "Volt", room: "rt_boardroom", base: "#D9D4CC", accent: "#3B2A1E", materials: ["Walnut", "Leather", "Marble"], style: "Premium Executive", lighting: "Linear pendant", furniture: ["Boardroom Table"] },
  { project: "Beta", room: "rt_meeting", base: "#4A4E52", accent: "#C87533", materials: ["Concrete", "Metal", "Glass"], style: "Industrial", lighting: "Track spots", furniture: ["Meeting Table"] },
  { project: "Gamma", room: "rt_meeting", base: "#E4E1D8", accent: "#6B5540", materials: ["Natural Wood", "Glass", "Fabric"], style: "Modern Minimal", lighting: "Warm ambient", furniture: ["Meeting Table"] },
  { project: "Gamma", room: "rt_cabin", base: "#DCE3D5", accent: "#4E6B4A", materials: ["Natural Wood", "Fabric"], style: "Nature Inspired", lighting: "Daylight", furniture: ["Desk"] },
];
