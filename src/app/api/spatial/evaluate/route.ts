import { readJson, route } from "@/modules/core/api";
import { RoomSpec } from "@/modules/core/schemas";
import { buildScene } from "@/modules/spatial/scene";
import { evaluate } from "@/modules/spatial/service";

/** Live validation + scene model for the measurement form. Does not save anything. */
export const POST = route(async (req) => {
  const spec = RoomSpec.parse(await readJson(req));
  const ev = await evaluate(spec);
  return { ...ev, scene: ev.issues.some((i) => i.level === "error" && ["length", "width", "height"].includes(i.field)) ? null : buildScene(spec) };
});
