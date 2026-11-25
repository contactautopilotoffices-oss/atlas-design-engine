import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { LocalBlobStore } from "@/modules/persistence/local-blob-store";
import { LocalJsonRepository } from "@/modules/persistence/local-json-store";
import { __setBackends } from "@/modules/persistence";

export function freshBackends() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "atlas-test-"));
  process.env.ATLAS_DATA_DIR = dir;
  const b = { repo: new LocalJsonRepository(dir), blobs: new LocalBlobStore(dir), dataDir: dir };
  __setBackends(b);
  return b;
}

/** Solid-ish test image with a distinct colour block so dedupe and palette tests are meaningful. */
export async function testPng(base: string, accent: string, w = 800, h = 600, label = "") {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${base}"/><rect x="${w / 4}" y="${h / 4}" width="${w / 2}" height="${h / 3}" fill="${accent}"/><text x="10" y="20" font-size="14">${label}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export const useBrowser = (name: string) => (globalThis as unknown as { __useBrowser: (n: string) => void }).__useBrowser(name);
