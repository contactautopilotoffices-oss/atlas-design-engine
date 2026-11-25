import { z } from "zod";
import { readJson, route } from "@/modules/core/api";
import { scanDocumentWithAi } from "@/modules/analysis/scanner";
import { requireStaff } from "@/modules/security/auth";

export const maxDuration = 300;

export const POST = route<{ id: string }>(async (req, { id }) => {
  const a = await requireStaff(["admin"]);
  const body = z
    .object({
      createFloorPlan: z.boolean().default(true),
      analyseImages: z.boolean().default(true),
      onlyUnanalysed: z.boolean().default(false),
    })
    .default({ createFloorPlan: true, analyseImages: true, onlyUnanalysed: false })
    .parse(await readJson(req).catch(() => ({})));
  return scanDocumentWithAi(id, `staff:${a.label}`, body);
});
