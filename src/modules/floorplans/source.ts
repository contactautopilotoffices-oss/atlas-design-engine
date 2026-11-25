import "server-only";
import sharp, { type Sharp } from "sharp";
import { extractImages, extractText, getDocumentProxy, renderPageAsImage } from "unpdf";
import { AppError } from "@/modules/core/util";

/** Claude works best with pictures no larger than this on the long side. */
export const AI_MAX_SIDE = 1568;
/** The drawing kept for the background is capped so pages stay quick to load. */
const KEEP_MAX_SIDE = 3200;

export type PlanPicture = {
  /** Picture kept as the plan background. */
  full: { png: Buffer; width: number; height: number };
  /** Same picture, smaller, sent to Claude. Coordinates scale by full.width / ai.width. */
  ai: { png: Buffer; width: number; height: number };
  page: number | null;
  pages: Array<{ page: number; text: string }>;
};

async function finish(img: Sharp, page: number | null, pages: PlanPicture["pages"]): Promise<PlanPicture> {
  const full = await img
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: KEEP_MAX_SIDE, height: KEEP_MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  const ai = await sharp(full.data)
    .resize({ width: AI_MAX_SIDE, height: AI_MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    full: { png: full.data, width: full.info.width, height: full.info.height },
    ai: { png: ai.data, width: ai.info.width, height: ai.info.height },
    page,
    pages,
  };
}

/** Picks the page most likely to be the layout: one that says LAYOUT or PLAN, else the first. */
export function guessPlanPage(pages: Array<{ page: number; text: string }>) {
  const hit = pages.find((p) => /\b(layout|floor\s*plan|furniture\s*plan|space\s*plan|proposed\s*plan)\b/i.test(p.text));
  return hit?.page ?? pages[0]?.page ?? 1;
}

export async function planPictureFromImage(buf: Buffer) {
  return finish(sharp(buf, { limitInputPixels: 2e8 }), null, []);
}

export async function planPictureFromPdf(buf: Buffer, wantedPage?: number | null): Promise<PlanPicture> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = Array.from({ length: totalPages }, (_, i) => ({ page: i + 1, text: (text[i] ?? "").replace(/\s+/g, " ").trim().slice(0, 120) }));
    const page = wantedPage ?? guessPlanPage(pages);
    if (page < 1 || page > totalPages) throw new AppError(`This PDF has ${totalPages} pages. Page ${page} does not exist.`);

    // A layout pasted into a slide is usually one big picture: use it directly, it is the sharpest copy.
    const imgs = await extractImages(pdf, page).catch(() => []);
    const big = imgs.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (big && Math.max(big.width, big.height) >= 1000) {
      return finish(sharp(Buffer.from(big.data), { raw: { width: big.width, height: big.height, channels: big.channels } }), page, pages);
    }
    // Otherwise the plan is drawn as vectors: render the whole page.
    let rendered: ArrayBuffer;
    try {
      const vp = (await pdf.getPage(page)).getViewport({ scale: 1 });
      rendered = await renderPageAsImage(pdf, page, { canvasImport: () => import("@napi-rs/canvas"), scale: Math.min(6, 3000 / Math.max(vp.width, vp.height)) });
    } catch {
      throw new AppError("Could not turn this PDF page into a picture. Export the plan page as a PNG or JPG and upload that instead.", 422, "render_failed");
    }
    return finish(sharp(Buffer.from(rendered)), page, pages);
  } finally {
    await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
  }
}
