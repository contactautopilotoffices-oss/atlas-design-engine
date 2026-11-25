import sharp, { type Sharp } from "sharp";
import { createHash } from "node:crypto";
import { dominantColours, type RGB } from "@/modules/intelligence/colour";

export const MIN_REFERENCE_SIDE = 160;

export type PreparedImage = {
  data: Buffer;
  mimeType: string;
  ext: string;
  width: number;
  height: number;
  thumb: Buffer;
  /** Hash of decoded pixels, so the same picture is recognised even when re-encoded or extracted from a different file. */
  pixelHash: string;
  palette: Array<{ hex: string; share: number }>;
};

/** Identify a standalone image by its bytes, not its file name. */
export async function probeImage(buf: Buffer) {
  try {
    const m = await sharp(buf, { failOn: "error" }).metadata();
    if (!m.format || !m.width || !m.height) return null;
    return { format: m.format, width: m.width, height: m.height };
  } catch {
    return null;
  }
}

/**
 * Normalises an image for the library: applies EXIF rotation, keeps JPEG/PNG/WebP as-is
 * otherwise converts to PNG, builds a 640px WebP thumbnail and samples the colour palette
 * from actual pixels (an observed fact, not an interpretation).
 */
export async function prepareImage(input: Buffer | { raw: Uint8Array | Uint8ClampedArray; width: number; height: number; channels: 1 | 2 | 3 | 4 }): Promise<PreparedImage> {
  let img: Sharp;
  let keepOriginal: Buffer | null = null;
  let mimeType = "image/png";
  let ext = "png";
  if (Buffer.isBuffer(input)) {
    const meta = await sharp(input).metadata();
    img = sharp(input).rotate();
    const fmt = meta.format;
    if ((fmt === "jpeg" || fmt === "png" || fmt === "webp") && !meta.orientation) {
      keepOriginal = input;
      mimeType = `image/${fmt}`;
      ext = fmt === "jpeg" ? "jpg" : fmt;
    }
  } else {
    img = sharp(Buffer.from(input.raw.buffer, input.raw.byteOffset, input.raw.byteLength), {
      raw: { width: input.width, height: input.height, channels: input.channels as 1 | 2 | 3 | 4 },
    });
  }
  const data = keepOriginal ?? (await img.clone().png({ compressionLevel: 8 }).toBuffer());
  const meta = await sharp(data).metadata();
  const thumb = await sharp(data).resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  const { data: px, info } = await sharp(data).resize(48, 48, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels: RGB[] = [];
  for (let i = 0; i < px.length; i += info.channels) pixels.push([px[i], px[i + 1], px[i + 2]]);
  const raw = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixelHash = createHash("sha256").update(`${raw.info.width}x${raw.info.height}:`).update(raw.data).digest("hex");
  return { data, mimeType, ext, width: meta.width ?? 0, height: meta.height ?? 0, thumb, pixelHash, palette: dominantColours(pixels, 5) };
}
