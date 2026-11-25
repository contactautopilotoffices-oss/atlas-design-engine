/**
 * Higgsfield image models and their DOCUMENTED capabilities.
 * Source: https://docs.higgsfield.ai (model pages checked 25 Nov 2026).
 * Only fields listed here are ever sent; the UI only exposes these options.
 */
export type ImageProvider = "higgsfield" | "openai";

export type ModelCapability = {
  id: string;
  provider?: ImageProvider;
  label: string;
  endpoint: string;
  docsUrl: string;
  referenceField: "image_urls" | "image" | null;
  minReferences: number;
  maxReferences: number;
  imagesPerRequest: { min: number; max: number; field: string | null };
  resolutions: string[];
  defaultResolution: string;
  aspectRatios: string[];
  defaultAspectRatio: string;
  extra: Record<string, { values: Array<string | boolean>; default: string | boolean }>;
  supportsNegativePrompt: boolean;
  notes: string;
};

export const MODELS: ModelCapability[] = [
  {
    id: "xai/grok-imagine-image-2.0",
    provider: "higgsfield",
    label: "Grok Image 2.0 (generate and edit with references)",
    endpoint: "/xai/grok-imagine-image-2.0",
    docsUrl: "https://docs.higgsfield.ai/docs/models/grok-image-2/generate-and-edit.md",
    referenceField: "image_urls",
    minReferences: 0,
    maxReferences: 10,
    imagesPerRequest: { min: 1, max: 1, field: null },
    resolutions: ["1k", "2k"],
    defaultResolution: "2k",
    aspectRatios: ["auto", "1:1", "1:2", "2:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"],
    defaultAspectRatio: "4:3",
    extra: { quality: { values: ["low", "medium"], default: "medium" } },
    supportsNegativePrompt: false,
    notes: "Accepts up to 10 ordered reference images. Returns one image per request; alternatives are separate requests. References may be resized by the provider.",
  },
  {
    id: "alibaba/qwen-image-3/edit",
    provider: "higgsfield",
    label: "Qwen Image 3 Edit (1 to 3 references)",
    endpoint: "/alibaba/qwen-image-3/edit",
    docsUrl: "https://docs.higgsfield.ai/docs/models/qwen-image-3/edit.md",
    referenceField: "image_urls",
    minReferences: 1,
    maxReferences: 3,
    imagesPerRequest: { min: 1, max: 1, field: null },
    resolutions: ["1k", "2k"],
    defaultResolution: "2k",
    aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "7:9", "9:7", "9:16", "16:9", "21:9"],
    defaultAspectRatio: "4:3",
    extra: {},
    supportsNegativePrompt: true,
    notes: "Requires 1 to 3 reference images. Supports a negative prompt. Unlisted fields are rejected by the API.",
  },
  {
    id: "higgsfield-ai/soul/standard",
    provider: "higgsfield",
    label: "Soul Standard (text only, no references)",
    endpoint: "/higgsfield-ai/soul/standard",
    docsUrl: "https://docs.higgsfield.ai/docs/models/soul-standard/generate.md",
    referenceField: null,
    minReferences: 0,
    maxReferences: 0,
    imagesPerRequest: { min: 1, max: 4, field: "num_images" },
    resolutions: ["2K", "4K"],
    defaultResolution: "2K",
    aspectRatios: ["1:1", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "16:9", "9:16", "21:9"],
    defaultAspectRatio: "4:3",
    extra: {},
    supportsNegativePrompt: false,
    notes: "Text-to-image only. Selected references are NOT sent as images to this model; it only receives the written brief.",
  },
];

export const getModel = (id: string) => MODELS.find((m) => m.id === id) ?? null;

/** Builds the provider request body using only documented fields for this model. */
export function buildRequestBody(
  model: ModelCapability,
  args: { prompt: string; negativePrompt?: string; imageUrls: string[]; resolution?: string; aspectRatio?: string; count?: number; extra?: Record<string, string | boolean> },
) {
  const body: Record<string, unknown> = { prompt: args.prompt };
  if (model.referenceField && args.imageUrls.length) body[model.referenceField] = args.imageUrls.slice(0, model.maxReferences);
  if (args.resolution && model.resolutions.includes(args.resolution)) body.resolution = args.resolution;
  if (args.aspectRatio && model.aspectRatios.includes(args.aspectRatio)) body.aspect_ratio = args.aspectRatio;
  if (model.imagesPerRequest.field && args.count) body[model.imagesPerRequest.field] = Math.min(model.imagesPerRequest.max, Math.max(1, args.count));
  if (model.supportsNegativePrompt && args.negativePrompt) body.negative_prompt = args.negativePrompt;
  for (const [k, spec] of Object.entries(model.extra)) {
    const v = args.extra?.[k];
    if (v !== undefined && spec.values.includes(v)) body[k] = v;
  }
  return body;
}
