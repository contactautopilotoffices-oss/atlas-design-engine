import { z } from "zod";
import { readJson, route } from "@/modules/core/api";
import { notFound } from "@/modules/core/util";
import { deletePlan, updatePlan } from "@/modules/floorplans/service";
import { repo } from "@/modules/persistence";
import { requireStaff } from "@/modules/security/auth";

const Pt = z.tuple([z.number().finite(), z.number().finite()]);
const Patch = z.object({
  name: z.string().max(120).optional(),
  rooms: z.array(z.object({ id: z.string().optional(), name: z.string().max(80), roomTypeId: z.string(), polygon: z.array(Pt).min(3).max(200) })).max(500).optional(),
  realWidthMetres: z.number().positive().optional(),
  confirmScale: z.boolean().optional(),
});

export const GET = route<{ id: string }>(async (_req, { id }) => {
  await requireStaff(["admin", "designer"]);
  const plan = await repo().get("floorPlans", id);
  if (!plan) throw notFound("Floor plan");
  return { plan };
});

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const a = await requireStaff(["admin"]);
  return { plan: await updatePlan(id, Patch.parse(await readJson(req)), `staff:${a.label}`) };
});

export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  const a = await requireStaff(["admin"]);
  await deletePlan(id, `staff:${a.label}`);
  return { ok: true };
});
