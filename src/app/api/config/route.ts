import { visionStatus } from "@/modules/analysis/vision";
import { route } from "@/modules/core/api";
import { repo } from "@/modules/persistence";
import { currentActor } from "@/modules/security/auth";

/** Read-only configuration needed by client and staff screens. */
export const GET = route(async () => {
  const r = repo();
  const staff = (await currentActor()).kind === "staff";
  const [roomTypes, offerings, properties, floorPlans, directions, materials, projects, settings] = await Promise.all([
    r.list("roomTypes"),
    r.list("offerings"),
    r.list("properties"),
    r.list("floorPlans"),
    r.list("designDirections"),
    r.list("materials"),
    r.list("projects"),
    r.get("settings", "app"),
  ]);
  return {
    roomTypes: roomTypes.sort((a, b) => a.sortOrder - b.sortOrder),
    offerings: offerings.sort((a, b) => a.rank - b.rank).map((o) => (staff ? o : { id: o.id, name: o.name, description: o.description, rank: o.rank, isDemo: o.isDemo })),
    properties: staff ? properties : properties.filter((p) => floorPlans.some((f) => f.propertyId === p.id && f.status !== "draft")),
    // Drafts are imported plans still being checked; only staff see them. Older plans saved
    // before drafts existed have no status and count as published.
    floorPlans: staff ? floorPlans : floorPlans.filter((f) => f.status !== "draft"),
    directions: staff ? directions : directions.filter((d) => d.status === "approved"),
    materials,
    projects: projects.map((p) => ({ id: p.id, name: p.name, propertyName: p.propertyName, city: p.city, isDemo: p.isDemo })),
    settings: staff ? settings : null,
    isStaff: staff,
    aiVisionConfigured: staff ? visionStatus().configured : false,
    persistence: { kind: r.kind, durable: r.durable },
  };
});
