/**
 * Prompt construction. Pure: brief + editable instruction lines in, prompt text out.
 * The reference images themselves are sent to the model separately (image_urls), in the
 * same order as listed here, so the text can address them as "Image 1", "Image 2", etc.
 */
import type { DesignBrief, ReferenceRole } from "@/modules/core/schemas";

const ROLE_TEXT: Record<ReferenceRole, string> = {
  primary: "primary design reference (overall design language and composition)",
  secondary: "secondary design reference",
  colour: "colour palette reference",
  material: "material and finish reference",
  lighting: "lighting reference",
  layout: "room layout and furniture arrangement reference",
};

export type BuiltPrompt = { prompt: string; negativePrompt: string; sections: Record<string, string> };

export type TierPromptContext = {
  name: string;
  description?: string;
  tierGuidance?: string;
  materials?: string[];
};

export function buildPrompt(
  brief: DesignBrief,
  opts: { instructions: string[]; negativePrompt: string; imageInputs: number; tier?: TierPromptContext | null },
): BuiltPrompt {
  const d = brief.dimensions;
  const unit = d.unit;
  const list = (xs: string[]) => (xs.length ? xs.join("; ") : "none specified");
  const tierText = opts.tier
    ? [
        `Target finish package tier: ${opts.tier.name}.`,
        opts.tier.tierGuidance || opts.tier.description || "",
        opts.tier.materials?.length ? `BOQ finish & fixture specification for this tier: ${opts.tier.materials.join("; ")}.` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  const sections: Record<string, string> = {
    project: [
      `Design a ${brief.roomTypeName}.`,
      brief.intendedUse && `Intended use: ${brief.intendedUse}.`,
      brief.occupancy ? `Occupancy: ${brief.occupancy} people.` : "",
      brief.designObjective && `Design objective: ${brief.designObjective}.`,
    ]
      .filter(Boolean)
      .join(" "),
    spatial: [
      `Room size ${d.length} x ${d.width} ${unit} with a ${d.height} ${unit} ceiling (proportion ${(d.length / d.width).toFixed(2)}:1).`,
      `Doors: ${list(brief.doors)}.`,
      `Windows: ${list(brief.windows)}.`,
      brief.fixedConstraints.length ? `Fixed elements to keep: ${list(brief.fixedConstraints)}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    design: [
      brief.designDirection && `Design direction: ${brief.designDirection}.`,
      (brief.colours.primary || brief.colours.secondary || brief.colours.tertiary) &&
        `Colours: primary ${brief.colours.primary ?? "n/a"}, secondary ${brief.colours.secondary ?? "n/a"}, accent ${brief.colours.tertiary ?? "n/a"}.`,
      `Materials: ${list(brief.materials)}.`,
      `Lighting: ${list(brief.lighting)}.`,
      `Furniture: ${list(brief.furniture)}.`,
    ]
      .filter(Boolean)
      .join(" "),
    ...(tierText ? { tier: tierText } : {}),
    references:
      opts.imageInputs > 0
        ? brief.references
            .slice(0, opts.imageInputs)
            .map((r, i) => `Image ${i + 1} (${r.referenceCode}, project ${r.projectName}) is the ${ROLE_TEXT[r.role]}.`)
            .join(" ")
        : brief.references.length
          ? `This model does not accept reference images; the selected references (${brief.references.map((r) => r.referenceCode).join(", ")}) are described in words only.`
          : "",
    instructions: opts.instructions.join(" "),
  };
  const prompt = [sections.project, sections.spatial, sections.design, sections.tier, sections.references, sections.instructions].filter(Boolean).join("\n\n");
  return { prompt, negativePrompt: opts.negativePrompt, sections };
}
