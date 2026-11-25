import { z } from "zod";
import { readJson, route } from "@/modules/core/api";
import { createProject, projectStats } from "@/modules/ingestion/service";
import { requireStaff } from "@/modules/security/auth";

export const GET = route(async () => {
  await requireStaff();
  return { projects: await projectStats() };
});

export const POST = route(async (req) => {
  const a = await requireStaff(["admin"]);
  const input = z
    .object({ name: z.string().trim().min(1).max(200), clientName: z.string().max(200).default(""), propertyName: z.string().max(200).default(""), city: z.string().max(100).default(""), category: z.string().max(100).default("") })
    .parse(await readJson(req));
  return { project: await createProject(input, `staff:${a.label}`) };
});
