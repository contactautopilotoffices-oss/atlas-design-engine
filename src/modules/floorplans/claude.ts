import "server-only";
/**
 * Reads rooms off a floor-plan picture with Claude (Anthropic Messages API).
 * The key stays on the server. Only the plan picture and instructions are sent.
 */
import { z } from "zod";
import { callClaudeTool } from "@/modules/analysis/anthropic";
import { env } from "@/modules/core/env";
import { AppError } from "@/modules/core/util";

type Fetch = typeof fetch;
let fetchImpl: Fetch | null = null;
/** Tests swap in a fake API so no real calls are made. */
export function __setPlanFetch(f: Fetch | null) {
  fetchImpl = f;
}

export function planReaderStatus() {
  const e = env();
  return e.ANTHROPIC_API_KEY
    ? { configured: true as const, model: e.ATLAS_PLAN_MODEL }
    : { configured: false as const, reason: "Add ANTHROPIC_API_KEY to .env to read rooms from PDF and image floor plans. DXF files work without it." };
}

export const FoundRoom = z.object({
  name: z.string().min(1),
  label_text: z.string().default(""),
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
});
export type FoundRoom = z.infer<typeof FoundRoom>;

const Report = z.object({
  rooms: z.array(FoundRoom),
  scale: z.object({ metres_per_pixel: z.number().positive().nullable().optional(), reasoning: z.string().default("") }).optional(),
});
export type PlanReading = { rooms: FoundRoom[]; metresPerPixel: number | null; scaleNote: string; model: string };

const TOOL = {
  name: "report_rooms",
  description: "Report the rooms found on the floor plan.",
  input_schema: {
    type: "object",
    properties: {
      rooms: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short clean room name in Title Case" },
            label_text: { type: "string", description: "Exact label text read from the drawing, empty if none" },
            x1: { type: "number" },
            y1: { type: "number" },
            x2: { type: "number" },
            y2: { type: "number" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["name", "x1", "y1", "x2", "y2", "confidence"],
        },
      },
      scale: {
        type: "object",
        properties: { metres_per_pixel: { type: "number" }, reasoning: { type: "string" } },
      },
    },
    required: ["rooms"],
  },
};

function prompt(w: number, h: number) {
  return `This image is an architectural office floor plan, ${w} x ${h} pixels. Pixel (0,0) is the top-left corner.
Find every enclosed room or clearly bounded zone a client could choose an interior design for: cabins, meeting and conference rooms, phone booths, pantry or cafeteria, lounge, collab areas, reception, workstation areas, control rooms, washrooms and so on. Skip corridors and passages, shafts, atrium voids, staircases and lifts.
For each one give the bounding rectangle along its walls in pixel coordinates (x1,y1 top-left, x2,y2 bottom-right), a short clean room name in Title Case (for example "Director Cabin 1" or "Conference Room (18 Pax)"), and the exact label text you read. Use the legend if there is one. If a room has no readable label, name it from what is drawn (a table with chairs is a meeting room) and set confidence to low.
Also estimate metres per pixel from things of known size (a standard workstation is about 1.2 m x 0.6 m, a door about 0.9 m, or printed dimension text) and say briefly what you used.

Report your answer by calling the report_rooms tool once.`;
}

/** Sends one PNG/JPEG (already sized to at most 1568 px on the long side) and returns the rooms found. */
export async function readPlanImage(image: { data: Buffer; mimeType: "image/png" | "image/jpeg"; width: number; height: number }): Promise<PlanReading> {
  const e = env();
  if (!e.ANTHROPIC_API_KEY) throw new AppError("Reading PDF or image plans needs ANTHROPIC_API_KEY in .env.", 503, "not_configured");
  const input = await callClaudeTool({
    apiKey: e.ANTHROPIC_API_KEY,
    model: e.ATLAS_PLAN_MODEL,
    maxTokens: 16000,
    tool: TOOL,
    content: [
      { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data.toString("base64") } },
      { type: "text", text: prompt(image.width, image.height) },
    ],
    actionLabel: "read the plan",
    fetchImpl: fetchImpl ?? undefined,
    timeoutMs: 240_000,
  });
  const parsed = Report.parse(input);
  return {
    rooms: parsed.rooms,
    metresPerPixel: parsed.scale?.metres_per_pixel ?? null,
    scaleNote: parsed.scale?.reasoning ?? "",
    model: e.ATLAS_PLAN_MODEL,
  };
}
