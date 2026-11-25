import { extractImages, extractText, getDocumentProxy } from "unpdf";
import { MIN_REFERENCE_SIDE } from "./images";

export type ExtractedPage = {
  page: number;
  text: string;
  images: Array<{ raw: Uint8ClampedArray; width: number; height: number; channels: 1 | 3 | 4 }>;
  error: string | null;
};

/**
 * Extracts per-page text and embedded raster images from a PDF.
 * Small images (icons, logos below MIN_REFERENCE_SIDE px) are skipped.
 * Pages whose images cannot be decoded are reported, not silently dropped.
 */
export async function extractPdf(buf: Buffer): Promise<{ pageCount: number; pages: ExtractedPage[] }> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages: ExtractedPage[] = [];
  for (let p = 1; p <= totalPages; p++) {
    const page: ExtractedPage = { page: p, text: (text[p - 1] ?? "").trim(), images: [], error: null };
    try {
      const imgs = await extractImages(pdf, p);
      page.images = imgs
        .filter((i) => i.width >= MIN_REFERENCE_SIDE && i.height >= MIN_REFERENCE_SIDE)
        .map((i) => ({ raw: i.data, width: i.width, height: i.height, channels: i.channels }));
    } catch (e) {
      page.error = `Could not decode images on page ${p}: ${e instanceof Error ? e.message : "unknown error"}`;
    }
    pages.push(page);
  }
  await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
  return { pageCount: totalPages, pages };
}
