import "server-only";
/**
 * Automated image understanding & presentation PDF scanning using Anthropic Claude Vision.
 * All AI-extracted metadata is recorded with provenance "ai" so reviewers can tell it apart
 * from observed pixel colours and human edits.
 */
import sharp from "sharp";
import { z } from "zod";
import { env } from "@/modules/core/env";
import type { ReferenceMetadata, RoomType } from "@/modules/core/schemas";
import { AppError } from "@/modules/core/util";
import { callClaudeTool, type ClaudeContentBlock } from "./anthropic";

export type ImageRole = "design_render" | "key_plan" | "floor_plan" | "mood_board" | "logo_or_other";

export type VisionAnalysisResult = {
  imageRole: ImageRole;
  summary: string;
  metadata: Partial<ReferenceMetadata>;
};

export type VisionContext = {
  projectName: string;
  sourceText: string;
  roomTypes?: Array<Pick<RoomType, "id" | "name">>;
  moodBoardSummary?: string;
};

export interface VisionProvider {
  readonly id: string;
  analyse(image: Buffer, mimeType: string, context: VisionContext): Promise<VisionAnalysisResult>;
}

type Fetch = typeof fetch;
let fetchImpl: Fetch | null = null;
/** Tests swap in a fake Anthropic API so no network or credits are used. */
export function __setVisionFetch(f: Fetch | null) {
  fetchImpl = f;
}

const AnalysisToolOut = z.object({
  imageRole: z.enum(["design_render", "key_plan", "floor_plan", "mood_board", "logo_or_other"]),
  summary: z.string().default(""),
  roomTypeId: z.string().nullable().default(null),
  designLanguage: z.string().nullable().default(null),
  visualCharacteristics: z.array(z.string()).default([]),
  architecturalLanguage: z.string().nullable().default(null),
  designIntent: z.string().nullable().default(null),
  materials: z
    .object({
      flooring: z.array(z.string()).default([]),
      walls: z.array(z.string()).default([]),
      ceiling: z.array(z.string()).default([]),
      furniture: z.array(z.string()).default([]),
      surfaces: z.array(z.string()).default([]),
      other: z.array(z.string()).default([]),
    })
    .default({ flooring: [], walls: [], ceiling: [], furniture: [], surfaces: [], other: [] }),
  lighting: z
    .object({
      natural: z.string().nullable().default(null),
      artificial: z.string().nullable().default(null),
      ambient: z.string().nullable().default(null),
      accent: z.string().nullable().default(null),
      temperatureK: z.number().int().positive().nullable().default(null),
    })
    .default({ natural: null, artificial: null, ambient: null, accent: null, temperatureK: null }),
  furniture: z
    .object({
      types: z.array(z.string()).default([]),
      arrangement: z.string().nullable().default(null),
      partitions: z.string().nullable().default(null),
      doorsWindows: z.string().nullable().default(null),
      composition: z.string().nullable().default(null),
      distinctiveElements: z.array(z.string()).default([]),
    })
    .default({ types: [], arrangement: null, partitions: null, doorsWindows: null, composition: null, distinctiveElements: [] }),
  classification: z
    .object({
      designCategory: z.string().nullable().default(null),
      tags: z.array(z.string()).default([]),
      keywords: z.array(z.string()).default([]),
    })
    .default({ designCategory: null, tags: [], keywords: [] }),
});

const ANALYSIS_TOOL = {
  name: "report_image_analysis",
  description: "Report the visual classification and interior-design metadata of this image.",
  input_schema: {
    type: "object",
    properties: {
      imageRole: {
        type: "string",
        enum: ["design_render", "key_plan", "floor_plan", "mood_board", "logo_or_other"],
        description:
          "design_render = 3D interior/exterior room render or photograph; key_plan = cropped 2D CAD key-plan snippet with arrow; floor_plan = full 2D architectural layout; mood_board = multi-photo collage/swatch board; logo_or_other = cover logo, icon, or non-room graphic.",
      },
      summary: { type: "string", description: "One concise sentence describing what is shown." },
      roomTypeId: { type: ["string", "null"], description: "Matching roomType ID from the provided list, or null for non-design images or unclear spaces." },
      designLanguage: { type: ["string", "null"], description: "e.g. Modern Vibrant, Industrial Contemporary, Warm Minimalist" },
      visualCharacteristics: { type: "array", items: { type: "string" } },
      architecturalLanguage: { type: ["string", "null"] },
      designIntent: { type: ["string", "null"] },
      materials: {
        type: "object",
        properties: {
          flooring: { type: "array", items: { type: "string" } },
          walls: { type: "array", items: { type: "string" } },
          ceiling: { type: "array", items: { type: "string" } },
          furniture: { type: "array", items: { type: "string" } },
          surfaces: { type: "array", items: { type: "string" } },
          other: { type: "array", items: { type: "string" } },
        },
      },
      lighting: {
        type: "object",
        properties: {
          natural: { type: ["string", "null"] },
          artificial: { type: ["string", "null"] },
          ambient: { type: ["string", "null"] },
          accent: { type: ["string", "null"] },
          temperatureK: { type: ["integer", "null"] },
        },
      },
      furniture: {
        type: "object",
        properties: {
          types: { type: "array", items: { type: "string" } },
          arrangement: { type: ["string", "null"] },
          partitions: { type: ["string", "null"] },
          doorsWindows: { type: ["string", "null"] },
          composition: { type: ["string", "null"] },
          distinctiveElements: { type: "array", items: { type: "string" } },
        },
      },
      classification: {
        type: "object",
        properties: {
          designCategory: { type: ["string", "null"] },
          tags: { type: "array", items: { type: "string" } },
          keywords: { type: "array", items: { type: "string" } },
        },
      },
    },
    required: ["imageRole", "summary", "roomTypeId"],
  },
};

export class AnthropicVisionProvider implements VisionProvider {
  readonly id: string;
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {
    this.id = `anthropic:${model}`;
  }

  async analyse(image: Buffer, _mimeType: string, context: VisionContext): Promise<VisionAnalysisResult> {
    const prepared = await sharp(image)
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();

    const roomList = (context.roomTypes ?? []).map((r) => `- ${r.id}: ${r.name}`).join("\n");
    const prompt = [
      `Analyse this image extracted from project "${context.projectName}".`,
      context.sourceText ? `Text printed on the source slide/page: ${context.sourceText.slice(0, 1200)}` : "",
      context.moodBoardSummary ? `Project mood-board context: ${context.moodBoardSummary}` : "",
      roomList ? `Available roomTypeId values (pick exact ID or null):\n${roomList}` : "",
      "Classify whether this is a real 3D room render/photo (design_render) vs a 2D key plan snippet (key_plan), full 2D floor plan (floor_plan), mood board collage (mood_board), or cover/logo (logo_or_other).",
      "For design_render images, fill materials, lighting, furniture, designLanguage, visualCharacteristics, and tags concisely and accurately from what is visible (never invent dimensions).",
      "Report your answer by calling report_image_analysis once.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const raw = await callClaudeTool({
      apiKey: this.apiKey,
      model: this.model,
      maxTokens: 2500,
      tool: ANALYSIS_TOOL,
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: prepared.toString("base64") } },
        { type: "text", text: prompt },
      ],
      actionLabel: "analyse the reference image",
      fetchImpl: fetchImpl ?? undefined,
      timeoutMs: 90_000,
    });

    const parsed = AnalysisToolOut.parse(raw);
    const validIds = new Set((context.roomTypes ?? []).map((r) => r.id));
    const roomTypeId = parsed.imageRole === "design_render" && parsed.roomTypeId && (validIds.size === 0 || validIds.has(parsed.roomTypeId)) ? parsed.roomTypeId : null;

    return {
      imageRole: parsed.imageRole,
      summary: parsed.summary,
      metadata: {
        roomTypeId,
        designLanguage: parsed.designLanguage,
        visualCharacteristics: parsed.visualCharacteristics,
        architecturalLanguage: parsed.architecturalLanguage,
        designIntent: parsed.designIntent,
        materials: parsed.materials,
        lighting: parsed.lighting,
        furniture: parsed.furniture,
        classification: {
          designCategory: parsed.classification.designCategory,
          offeringIds: [],
          tags: parsed.classification.tags,
          keywords: parsed.classification.keywords,
        },
      },
    };
  }
}

export function getVisionProvider(): VisionProvider | null {
  const key = env().ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  return new AnthropicVisionProvider(key, env().ATLAS_VISION_MODEL);
}

export const visionStatus = () => {
  const p = getVisionProvider();
  return p
    ? { configured: true as const, provider: p.id }
    : { configured: false as const, provider: null, reason: "Add ANTHROPIC_API_KEY to .env to enable Claude Vision image analysis." };
};

const PdfOverviewOut = z.object({
  projectDetails: z
    .object({
      projectName: z.string().nullable().default(null),
      location: z.string().nullable().default(null),
      date: z.string().nullable().default(null),
      presentedBy: z.string().nullable().default(null),
    })
    .default({ projectName: null, location: null, date: null, presentedBy: null }),
  moodBoard: z
    .object({
      page: z.number().int().positive().nullable().default(null),
      styleSummary: z.string().default(""),
      colorPalette: z.array(z.object({ name: z.string(), hex: z.string().nullable().default(null) })).default([]),
      materialPalette: z.array(z.string()).default([]),
    })
    .nullable()
    .default(null),
  layoutPage: z.number().int().positive().nullable().default(null),
  layoutLegend: z
    .array(
      z.object({
        name: z.string(),
        capacity: z.string().default(""),
        count: z.number().int().positive().nullable().default(null),
      }),
    )
    .default([]),
});

const PDF_OVERVIEW_TOOL = {
  name: "report_pdf_overview",
  description: "Report extracted project details, mood board colors/materials, layout page number, and layout legend table from the presentation PDF.",
  input_schema: {
    type: "object",
    properties: {
      projectDetails: {
        type: "object",
        properties: {
          projectName: { type: ["string", "null"] },
          location: { type: ["string", "null"] },
          date: { type: ["string", "null"] },
          presentedBy: { type: ["string", "null"] },
        },
      },
      moodBoard: {
        type: ["object", "null"],
        properties: {
          page: { type: ["integer", "null"] },
          styleSummary: { type: "string" },
          colorPalette: {
            type: "array",
            items: { type: "object", properties: { name: { type: "string" }, hex: { type: ["string", "null"] } }, required: ["name"] },
          },
          materialPalette: { type: "array", items: { type: "string" } },
        },
      },
      layoutPage: { type: ["integer", "null"], description: "1-based page number of the main 2D floor plan layout, or null if none." },
      layoutLegend: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            capacity: { type: "string" },
            count: { type: ["integer", "null"] },
          },
          required: ["name"],
        },
      },
    },
    required: ["projectDetails", "layoutPage", "layoutLegend"],
  },
};

/** Uses Claude Vision to read cover details, mood board palette/materials, and 2D layout legend from key PDF pages. */
export async function scanPdfOverviewWithClaude(args: {
  pageImages: Array<{ page: number; label: string; png: Buffer }>;
  pageText: Array<{ page: number; text: string }>;
}) {
  const e = env();
  if (!e.ANTHROPIC_API_KEY) throw new AppError("Scanning PDF overview requires ANTHROPIC_API_KEY in .env.", 503, "not_configured");
  const content: ClaudeContentBlock[] = [];
  for (const p of args.pageImages) {
    content.push({ type: "text", text: `Page ${p.page} (${p.label}):` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: p.png.toString("base64") } });
  }
  const textOutline = args.pageText.map((p) => `Page ${p.page}: ${p.text.slice(0, 300)}`).join("\n");
  content.push({
    type: "text",
    text: `Here is the extracted text per page:\n${textOutline}\n\nExtract the project details (name, location, date, presenter), the mood board (style summary, named color swatches with approximate hex, named material swatches), the 1-based page number of the main 2D floor plan layout (if any), and every row of the layout legend table (space name, capacity/PAX, room count). Call report_pdf_overview once.`,
  });

  const raw = await callClaudeTool({
    apiKey: e.ANTHROPIC_API_KEY,
    model: e.ATLAS_VISION_MODEL,
    maxTokens: 4000,
    tool: PDF_OVERVIEW_TOOL,
    content,
    actionLabel: "scan the PDF presentation overview",
    fetchImpl: fetchImpl ?? undefined,
    timeoutMs: 120_000,
  });
  return { ...PdfOverviewOut.parse(raw), model: e.ATLAS_VISION_MODEL };
}
