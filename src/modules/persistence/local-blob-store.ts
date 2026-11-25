import { promises as fs } from "node:fs";
import path from "node:path";
import type { BlobBucket, BlobStore } from "./types";

const safeKey = (key: string) => {
  const parts = key.split("/").filter(Boolean);
  if (parts.some((p) => p === ".." || p.includes("\\"))) throw new Error("Invalid blob key");
  return parts.join("/");
};

/** Stores binary files under <dataDir>/blobs/<bucket>/<key> with a sidecar content-type file. */
export class LocalBlobStore implements BlobStore {
  readonly kind = "local-fs" as const;
  constructor(private readonly dataDir: string) {}

  private p(bucket: BlobBucket, key: string) {
    return path.join(this.dataDir, "blobs", bucket, safeKey(key));
  }

  async put(bucket: BlobBucket, key: string, data: Buffer, contentType: string) {
    const file = this.p(bucket, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
    await fs.writeFile(`${file}.meta`, contentType, "utf8");
  }

  async get(bucket: BlobBucket, key: string) {
    const file = this.p(bucket, key);
    try {
      const [data, contentType] = await Promise.all([
        fs.readFile(file),
        fs.readFile(`${file}.meta`, "utf8").catch(() => "application/octet-stream"),
      ]);
      return { data, contentType };
    } catch {
      return null;
    }
  }

  async remove(bucket: BlobBucket, key: string) {
    const file = this.p(bucket, key);
    await fs.rm(file, { force: true });
    await fs.rm(`${file}.meta`, { force: true });
  }
}
