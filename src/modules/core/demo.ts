import "server-only";
/**
 * Optional, clearly labelled DEMO content so the client flow can be shown before real
 * presentations are uploaded. Images are synthetic drawings with "DEMO" printed on them.
 * They are never presented as company project data, and can be removed in one click.
 */
import sharp from "sharp";
import { createProject, deleteProject, ingestFile } from "@/modules/ingestion/service";
import { repo } from "@/modules/persistence";
import { ReferenceMetadata } from "./schemas";
import { audit } from "./audit";
import { now } from "./util";

type DemoRef = { room: string; wall: string; floor: string; accent: string; table: string; materials: string[]; style: string; lighting: string; furniture: string[] };

const PROJECTS: Array<{ name: string; refs: DemoRef[] }> = [
  {
    name: "DEMO Project Alpha (synthetic)",
    refs: [
      { room: "rt_meeting", wall: "#E8E1D6", floor: "#A07850", accent: "#2F3A40", table: "#6F573E", materials: ["Natural Wood", "Glass"], style: "Modern Minimal", lighting: "Warm ambient", furniture: ["Meeting Table", "Meeting Chairs"] },
      { room: "rt_boardroom", wall: "#D9D4CC", floor: "#5B4636", accent: "#1F2A30", table: "#3B2A1E", materials: ["Walnut Veneer", "Leather", "Glass"], style: "Premium Executive", lighting: "Linear pendant", furniture: ["Boardroom Table", "Executive Chairs"] },
      { room: "rt_reception", wall: "#F1ECE4", floor: "#C9B9A3", accent: "#8C6E4E", table: "#B08A5E", materials: ["Natural Wood", "Stone"], style: "Modern Minimal", lighting: "Warm ambient", furniture: ["Reception Desk", "Lounge Seating"] },
    ],
  },
  {
    name: "DEMO Project Beta (synthetic)",
    refs: [
      { room: "rt_meeting", wall: "#4A4E52", floor: "#7A7A78", accent: "#C87533", table: "#2B2B2B", materials: ["Exposed Concrete", "Metal", "Glass"], style: "Industrial Contemporary", lighting: "Track spotlights", furniture: ["Meeting Table", "Meeting Chairs"] },
      { room: "rt_cabin", wall: "#DCE3D5", floor: "#9C8361", accent: "#4E6B4A", table: "#7D6347", materials: ["Natural Wood", "Fabric", "Planters"], style: "Nature Inspired", lighting: "Daylight", furniture: ["Desk", "Task Chair"] },
      { room: "rt_meeting", wall: "#E4E7DF", floor: "#A3906F", accent: "#5E7D57", table: "#8A6E4C", materials: ["Natural Wood", "Fabric"], style: "Nature Inspired", lighting: "Daylight", furniture: ["Round Table", "Meeting Chairs"] },
    ],
  },
];

function svg(r: DemoRef, label: string) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
  <rect width="1200" height="800" fill="${r.wall}"/>
  <polygon points="0,560 1200,560 1200,800 0,800" fill="${r.floor}"/>
  <rect x="120" y="140" width="300" height="260" fill="#FFFFFF" opacity="0.55"/>
  <rect x="780" y="120" width="12" height="440" fill="${r.accent}"/>
  <ellipse cx="600" cy="200" rx="160" ry="18" fill="#FFF6E0" opacity="0.9"/>
  <rect x="380" y="500" width="440" height="40" rx="6" fill="${r.table}"/>
  <rect x="420" y="540" width="16" height="110" fill="${r.table}"/><rect x="764" y="540" width="16" height="110" fill="${r.table}"/>
  ${[0, 1, 2, 3].map((i) => `<rect x="${410 + i * 105}" y="455" width="60" height="70" rx="10" fill="${r.accent}"/>`).join("")}
  <text x="40" y="70" font-family="Arial" font-size="44" font-weight="bold" fill="#B00020">DEMO IMAGE: NOT A REAL PROJECT</text>
  <text x="40" y="760" font-family="Arial" font-size="30" fill="#FFFFFF">${label}</text>
</svg>`);
}

export async function loadDemoContent(actor: string) {
  if ((await repo().list("projects")).some((p) => p.isDemo)) return { created: false, message: "Demo content is already loaded." };
  for (const p of PROJECTS) {
    const project = await createProject({ name: p.name, clientName: "Demo client", propertyName: "Demo property", city: "Mumbai", category: "Demo" }, actor, true);
    for (const [i, r] of p.refs.entries()) {
      const png = await sharp(svg(r, `${p.name} / ${r.style}`)).png().toBuffer();
      const res = await ingestFile({ projectId: project.id, filename: `demo-${i + 1}.png`, data: png, actor, isDemo: true });
      const ref = (await repo().list("references", { documentId: res.document.id }))[0];
      if (!ref) continue;
      const md = ReferenceMetadata.parse({
        ...ref.metadata,
        roomTypeId: r.room,
        designLanguage: r.style,
        visualCharacteristics: [r.style],
        materials: { flooring: [r.materials[0]], walls: [], ceiling: [], furniture: r.materials.slice(1), surfaces: [], other: [] },
        lighting: { natural: r.lighting === "Daylight" ? "Large windows" : null, artificial: r.lighting, ambient: r.lighting.includes("ambient") ? r.lighting : null, accent: null, temperatureK: null },
        furniture: { types: r.furniture, arrangement: null, partitions: null, doorsWindows: null, composition: null, distinctiveElements: [] },
        classification: { designCategory: r.style, offeringIds: [], tags: ["demo"], keywords: [] },
        notes: "Synthetic demo record. Not company project data.",
      });
      await repo().update("references", ref.id, { metadata: md, reviewStatus: "approved", reviewedBy: "demo-seed", reviewedAt: now(), updatedAt: now() });
    }
  }
  await audit("demo.load", actor, "system", null);
  return { created: true, message: "Demo content loaded. Every demo image is labelled DEMO." };
}

export async function removeDemoContent(actor: string) {
  const projects = (await repo().list("projects")).filter((p) => p.isDemo);
  for (const p of projects) await deleteProject(p.id, actor, { force: true });
  await audit("demo.remove", actor, "system", null, { projects: projects.length });
  return { removed: projects.length };
}
