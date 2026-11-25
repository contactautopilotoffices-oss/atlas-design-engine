import JSZip from "jszip";
import type { DocumentKind } from "@/modules/core/schemas";
import { AppError } from "@/modules/core/util";
import { probeImage } from "./images";

const IMAGE_FORMATS = new Set(["jpeg", "png", "webp"]);

/**
 * Decides the document kind from the file's actual bytes. The extension is only used to
 * give a helpful message for legacy .ppt files, which this app cannot parse.
 */
export async function detectKind(filename: string, buf: Buffer, maxBytes: number): Promise<{ kind: DocumentKind; mimeType: string }> {
  if (buf.length === 0) throw new AppError(`"${filename}" is empty.`);
  if (buf.length > maxBytes) throw new AppError(`"${filename}" is larger than the ${Math.round(maxBytes / 1048576)} MB upload limit.`, 413, "too_large");
  const lower = filename.toLowerCase();
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return { kind: "pdf", mimeType: "application/pdf" };
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const zip = await JSZip.loadAsync(buf).catch(() => null);
    if (zip?.file("ppt/presentation.xml"))
      return { kind: "pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
    throw new AppError(`"${filename}" is a ZIP-based file but not a PowerPoint presentation.`, 415, "unsupported_type");
  }
  if (buf[0] === 0xd0 && buf[1] === 0xcf && lower.endsWith(".ppt"))
    throw new AppError(
      `"${filename}" is an old-style .ppt file. Please open it in PowerPoint or Google Slides and save it as .pptx, then upload again.`,
      415,
      "legacy_ppt",
    );
  const img = await probeImage(buf);
  if (img && IMAGE_FORMATS.has(img.format)) return { kind: "image", mimeType: `image/${img.format}` };
  throw new AppError(`"${filename}" is not a supported file. Use PDF, PPTX, JPG, PNG or WEBP.`, 415, "unsupported_type");
}
