/**
 * Unified image generation model registry across Higgsfield and OpenAI.
 * Source: https://docs.higgsfield.ai & https://platform.openai.com/docs/models (checked Nov 2026).
 */
import { MODELS as HIGGSFIELD_MODELS, buildRequestBody, type ImageProvider, type ModelCapability } from "@/modules/higgsfield/models";

export type { ImageProvider, ModelCapability };
export { buildRequestBody };

export const OPENAI_MODELS: ModelCapability[] = [
  {
    id: "openai/gpt-image-2.6-sunburst",
    provider: "openai",
    label: "OpenAI · GPT Image 2.6 Sunburst (high precision, references)",
    endpoint: "gpt-image-2.6-sunburst",
    docsUrl: "https://platform.openai.com/docs/models/gpt-image-2.6-sunburst",
    referenceField: "image",
    minReferences: 0,
    maxReferences: 16,
    imagesPerRequest: { min: 1, max: 4, field: "n" },
    resolutions: ["1k", "2k"],
    defaultResolution: "1k",
    aspectRatios: ["auto", "1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"],
    defaultAspectRatio: "4:3",
    extra: { quality: { values: ["low", "medium", "high"], default: "medium" } },
    supportsNegativePrompt: false,
    notes: "OpenAI's highest-precision image model. Accepts up to 16 reference images via /v1/images/edits, or generates from text via /v1/images/generations.",
  },
  {
    id: "openai/gpt-image-2.6-flare",
    provider: "openai",
    label: "OpenAI · GPT Image 2.6 Flare (fast concepts, references)",
    endpoint: "gpt-image-2.6-flare",
    docsUrl: "https://platform.openai.com/docs/models/gpt-image-2.6-flare",
    referenceField: "image",
    minReferences: 0,
    maxReferences: 16,
    imagesPerRequest: { min: 1, max: 4, field: "n" },
    resolutions: ["1k", "2k"],
    defaultResolution: "1k",
    aspectRatios: ["auto", "1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"],
    defaultAspectRatio: "4:3",
    extra: { quality: { values: ["low", "medium", "high"], default: "medium" } },
    supportsNegativePrompt: false,
    notes: "OpenAI's fast GPT Image 2.6 variant for quick concepting and up to 16 reference images.",
  },
  {
    id: "openai/gpt-image-1.5",
    provider: "openai",
    label: "OpenAI · GPT Image 1.5 (references supported)",
    endpoint: "gpt-image-1.5",
    docsUrl: "https://platform.openai.com/docs/models/gpt-image-1.5",
    referenceField: "image",
    minReferences: 0,
    maxReferences: 16,
    imagesPerRequest: { min: 1, max: 4, field: "n" },
    resolutions: ["standard"],
    defaultResolution: "standard",
    aspectRatios: ["auto", "1:1", "3:2", "2:3"],
    defaultAspectRatio: "3:2",
    extra: { quality: { values: ["low", "medium", "high"], default: "medium" } },
    supportsNegativePrompt: false,
    notes: "Accepts up to 16 reference images at standard presets (1024x1024, 1536x1024, 1024x1536).",
  },
  {
    id: "openai/gpt-image-1-mini",
    provider: "openai",
    label: "OpenAI · GPT Image 1 Mini (economical, references)",
    endpoint: "gpt-image-1-mini",
    docsUrl: "https://platform.openai.com/docs/models/gpt-image-1-mini",
    referenceField: "image",
    minReferences: 0,
    maxReferences: 16,
    imagesPerRequest: { min: 1, max: 4, field: "n" },
    resolutions: ["standard"],
    defaultResolution: "standard",
    aspectRatios: ["auto", "1:1", "3:2", "2:3"],
    defaultAspectRatio: "3:2",
    extra: { quality: { values: ["low", "medium", "high"], default: "medium" } },
    supportsNegativePrompt: false,
    notes: "Lower-cost OpenAI GPT Image model supporting up to 16 reference images.",
  },
];

export const ALL_MODELS: ModelCapability[] = [...HIGGSFIELD_MODELS, ...OPENAI_MODELS];

export function getAnyModel(id: string): ModelCapability | null {
  return ALL_MODELS.find((m) => m.id === id || m.endpoint === id) ?? null;
}

export function modelProvider(model: ModelCapability): ImageProvider {
  return model.provider ?? "higgsfield";
}

const SIZE_1K: Record<string, string> = {
  auto: "auto",
  "1:1": "1024x1024",
  "4:3": "1344x1008",
  "3:4": "1008x1344",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
  "16:9": "1536x864",
  "9:16": "864x1536",
};

const SIZE_2K: Record<string, string> = {
  auto: "auto",
  "1:1": "2048x2048",
  "4:3": "2048x1536",
  "3:4": "1536x2048",
  "3:2": "2048x1360",
  "2:3": "1360x2048",
  "16:9": "2048x1152",
  "9:16": "1152x2048",
};

/** Maps UI resolution + aspect ratio to a documented OpenAI WIDTHxHEIGHT (divisible by 16) or "auto". */
export function resolveOpenAISize(model: ModelCapability, resolution?: string, aspectRatio?: string): string {
  const ar = aspectRatio && model.aspectRatios.includes(aspectRatio) ? aspectRatio : model.defaultAspectRatio;
  if (ar === "auto") return "auto";
  const res = resolution && model.resolutions.includes(resolution) ? resolution : model.defaultResolution;
  const table = res === "2k" ? SIZE_2K : SIZE_1K;
  return table[ar] ?? "auto";
}
