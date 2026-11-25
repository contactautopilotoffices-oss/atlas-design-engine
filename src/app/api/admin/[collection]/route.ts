import { readJson, route } from "@/modules/core/api";
import { assertConfigCollection, createConfig } from "@/modules/core/admin";
import { repo } from "@/modules/persistence";
import { requireStaff } from "@/modules/security/auth";

export const GET = route<{ collection: string }>(async (_req, { collection }) => {
  await requireStaff(["admin"]);
  assertConfigCollection(collection);
  return { items: await repo().list(collection) };
});

export const POST = route<{ collection: string }>(async (req, { collection }) => {
  const a = await requireStaff(["admin"]);
  assertConfigCollection(collection);
  return { item: await createConfig(collection, await readJson(req), `staff:${a.label}`) };
});
