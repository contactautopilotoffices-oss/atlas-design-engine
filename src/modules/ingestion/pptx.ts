import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import path from "node:path";

export type ExtractedSlide = {
  slide: number;
  text: string;
  images: Array<{ data: Buffer; mediaPath: string }>;
  skipped: string[];
};

const RASTER = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function relsMap(xml: string | undefined): Map<string, { target: string; type: string }> {
  const map = new Map<string, { target: string; type: string }>();
  if (!xml) return map;
  const doc = parser.parse(xml);
  const rels = doc?.Relationships?.Relationship;
  for (const r of Array.isArray(rels) ? rels : rels ? [rels] : []) map.set(r["@_Id"], { target: r["@_Target"], type: r["@_Type"] ?? "" });
  return map;
}

/**
 * Reads a PPTX in presentation order (ppt/presentation.xml sldIdLst), returning each slide's
 * text runs and the raster images it embeds (resolved through the slide's relationships).
 * Vector formats (EMF/WMF/SVG) are reported as skipped.
 */
export async function extractPptx(buf: Buffer): Promise<{ slideCount: number; slides: ExtractedSlide[] }> {
  const zip = await JSZip.loadAsync(buf);
  const presXml = await zip.file("ppt/presentation.xml")?.async("string");
  const presRels = relsMap(await zip.file("ppt/_rels/presentation.xml.rels")?.async("string"));
  let order: string[] = [];
  if (presXml) {
    const pres = parser.parse(presXml);
    const ids = pres?.["p:presentation"]?.["p:sldIdLst"]?.["p:sldId"];
    order = (Array.isArray(ids) ? ids : ids ? [ids] : [])
      .map((s: Record<string, string>) => presRels.get(s["@_r:id"])?.target)
      .filter((t: string | undefined): t is string => Boolean(t))
      .map((t: string) => path.posix.normalize(path.posix.join("ppt", t)));
  }
  if (!order.length) {
    order = Object.keys(zip.files)
      .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  }

  const slides: ExtractedSlide[] = [];
  for (const [i, slidePath] of order.entries()) {
    const xml = (await zip.file(slidePath)?.async("string")) ?? "";
    const text = Array.from(xml.matchAll(/<a:t>([^<]*)<\/a:t>/g))
      .map((m) => m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const relsPath = path.posix.join(path.posix.dirname(slidePath), "_rels", `${path.posix.basename(slidePath)}.rels`);
    const rels = relsMap(await zip.file(relsPath)?.async("string"));
    const embedIds = Array.from(new Set(Array.from(xml.matchAll(/r:embed="([^"]+)"/g)).map((m) => m[1])));
    const slide: ExtractedSlide = { slide: i + 1, text, images: [], skipped: [] };
    for (const rid of embedIds) {
      const rel = rels.get(rid);
      if (!rel || !rel.type.endsWith("/image")) continue;
      const mediaPath = path.posix.normalize(path.posix.join(path.posix.dirname(slidePath), rel.target));
      if (!RASTER.test(mediaPath)) {
        slide.skipped.push(`${path.posix.basename(mediaPath)} (vector or unsupported format)`);
        continue;
      }
      const data = await zip.file(mediaPath)?.async("nodebuffer");
      if (data) slide.images.push({ data, mediaPath });
      else slide.skipped.push(`${path.posix.basename(mediaPath)} (missing from file)`);
    }
    slides.push(slide);
  }
  return { slideCount: slides.length, slides };
}
