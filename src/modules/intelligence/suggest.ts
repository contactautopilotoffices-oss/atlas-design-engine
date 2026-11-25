/**
 * Suggests a room type for an extracted picture from the text printed on its source page
 * (for example "14 CONFERENCE ROOM Project VOLT") or AI vision analysis.
 * It is only a suggestion: a person confirms it.
 * Small pictures (logos, icons, key plans) and non-render AI roles are flagged as probably not a design.
 */
import type { ReferenceAsset, RoomType } from "@/modules/core/schemas";

export const SMALL_PICTURE_MAX_SIDE = 700;

export type RoomSuggestion = { roomTypeId: string | null; matched: string | null; likelyNotDesign: boolean };

export function suggestRoomType(
  ref: {
    sourceText: string;
    width: number;
    height: number;
    metadata?: Pick<ReferenceAsset["metadata"], "roomTypeId">;
    provenance?: ReferenceAsset["provenance"];
    analysis?: Pick<ReferenceAsset["analysis"], "imageRole">;
  },
  roomTypes: RoomType[],
): RoomSuggestion {
  const aiNonDesign = Boolean(ref.analysis?.imageRole && ref.analysis.imageRole !== "design_render");
  const likelyNotDesign = Math.max(ref.width, ref.height) < SMALL_PICTURE_MAX_SIDE || aiNonDesign;
  if (aiNonDesign) {
    return { roomTypeId: null, matched: `AI: ${ref.analysis!.imageRole!.replace("_", " ")}`, likelyNotDesign: true };
  }
  // Split words that slide titles often run together, e.g. "CAFETERIAProject" -> "CAFETERIA Project".
  const spaced = ref.sourceText.replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").replace(/([a-z])([A-Z])/g, "$1 $2");
  const text = ` ${spaced.toLowerCase().replace(/[^a-z]+/g, " ")} `;
  let best: { id: string; term: string } | null = null;
  for (const rt of roomTypes) {
    const terms = [rt.name, ...rt.spatialProfile.purposeKeywords].map((t) => t.toLowerCase().replace(/[^a-z]+/g, " ").trim()).filter((t) => t.length >= 4);
    for (const term of terms) {
      // whole-word match, allowing a plural "s"
      const re = new RegExp(`\\b${term.replace(/\s+/g, "\\s+")}s?\\b`);
      if (re.test(text) && (!best || term.length > best.term.length)) best = { id: rt.id, term };
    }
  }
  if (best) return { roomTypeId: best.id, matched: best.term, likelyNotDesign };
  if (ref.provenance?.roomTypeId === "ai" && ref.metadata?.roomTypeId && roomTypes.some((t) => t.id === ref.metadata!.roomTypeId)) {
    return { roomTypeId: ref.metadata.roomTypeId, matched: "AI vision analysis", likelyNotDesign };
  }
  return { roomTypeId: null, matched: null, likelyNotDesign };
}
