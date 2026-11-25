/**
 * Room-type classification from several signals. There is deliberately no single size cut-off:
 * each room type's configurable spatialProfile contributes evidence from the stated purpose,
 * seating capacity, table arrangement, furniture and area per person, and the user's own
 * classification carries the most weight. Conflicts are surfaced for review.
 */
import type { ClassificationResult, RoomSpec, RoomType } from "@/modules/core/schemas";
import { norm } from "@/modules/core/util";
import { toMetres } from "./validate";

export function classifyRoom(input: RoomSpec, roomTypes: RoomType[]): ClassificationResult {
  const s = toMetres(input);
  const purpose = norm(s.intendedUse);
  const arrangement = norm(s.tableArrangement);
  const furnitureText = s.furniture.map((f) => norm(f.type)).join(" ");
  const seats = s.furniture.filter((f) => /chair|seat|stool|sofa/i.test(f.type)).reduce((n, f) => n + f.count, 0) || s.occupancy;
  const area = s.length * s.width;

  const scores = roomTypes.map((rt) => {
    const p = rt.spatialProfile;
    const reasons: string[] = [];
    let score = 0;
    if (s.roomTypeId === rt.id) {
      score += 3;
      reasons.push("Chosen by the user (+3)");
    }
    const kw = p.purposeKeywords.filter((k) => purpose.includes(norm(k)) || furnitureText.includes(norm(k)));
    if (kw.length) {
      score += Math.min(2, kw.length);
      reasons.push(`Purpose mentions ${kw.join(", ")} (+${Math.min(2, kw.length)})`);
    }
    if (seats > 0 && (p.minSeats != null || p.maxSeats != null)) {
      const lo = p.minSeats ?? 0;
      const hi = p.maxSeats ?? Infinity;
      if (seats >= lo && seats <= hi) {
        score += 1.5;
        reasons.push(`${seats} seats within typical ${lo}-${hi === Infinity ? "+" : hi} (+1.5)`);
      } else {
        score -= 1;
        reasons.push(`${seats} seats outside typical ${lo}-${hi === Infinity ? "+" : hi} (-1)`);
      }
    }
    if (arrangement && p.tableArrangements.some((t) => norm(t) === arrangement)) {
      score += 1;
      reasons.push(`"${s.tableArrangement}" arrangement is typical (+1)`);
    }
    if (p.areaPerPersonM2 && s.occupancy > 0) {
      const per = area / s.occupancy;
      if (per >= p.areaPerPersonM2 * 0.75 && per <= p.areaPerPersonM2 * 3) {
        score += 0.5;
        reasons.push(`${per.toFixed(1)} m2/person fits this type (+0.5)`);
      }
    }
    return { roomTypeId: rt.id, score: Math.round(score * 10) / 10, reasons };
  });
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const second = scores[1];
  const margin = best && second ? best.score - second.score : best?.score ?? 0;
  const confidence: ClassificationResult["confidence"] = !best || best.score <= 0 ? "low" : margin >= 2 ? "high" : margin >= 1 ? "medium" : "low";

  const contradictions: string[] = [];
  if (s.roomTypeId) {
    const chosen = scores.find((x) => x.roomTypeId === s.roomTypeId);
    const chosenName = roomTypes.find((r) => r.id === s.roomTypeId)?.name ?? s.roomTypeId;
    const topName = roomTypes.find((r) => r.id === best?.roomTypeId)?.name;
    if (chosen && best && best.roomTypeId !== s.roomTypeId && best.score - chosen.score >= 1)
      contradictions.push(`You chose ${chosenName}, but purpose, seating and layout point more strongly to ${topName}.`);
    const rt = roomTypes.find((r) => r.id === s.roomTypeId);
    if (rt?.spatialProfile.minSeats != null && seats > 0 && seats < rt.spatialProfile.minSeats)
      contradictions.push(`${chosenName} usually seats at least ${rt.spatialProfile.minSeats}; ${seats} requested.`);
    if (rt?.spatialProfile.maxSeats != null && seats > rt.spatialProfile.maxSeats)
      contradictions.push(`${chosenName} usually seats at most ${rt.spatialProfile.maxSeats}; ${seats} requested.`);
  }
  return { suggestedRoomTypeId: best && best.score > 0 ? best.roomTypeId : null, confidence, scores, contradictions };
}
