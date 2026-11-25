import "server-only";
import os from "node:os";
import path from "node:path";
import { env, isVercel, supabaseConfigured } from "@/modules/core/env";
import { AppError } from "@/modules/core/util";
import { LocalBlobStore } from "./local-blob-store";
import { LocalJsonRepository } from "./local-json-store";
import { createSupabaseServerClient, SupabaseBlobStore, SupabaseRepository } from "./supabase-store";
import type { BlobStore, Repository } from "./types";

export type { BlobStore, Repository } from "./types";

type Backends = { repo: Repository; blobs: BlobStore; dataDir: string | null };
let backends: Backends | null = null;

export function dataDir() {
  return env().ATLAS_DATA_DIR ?? path.join(process.cwd(), ".atlas-design");
}

/**
 * Chooses the persistence backend:
 * - ATLAS_PERSISTENCE=supabase, or auto with Supabase configured  -> Supabase (durable cloud)
 * - local development                                             -> .atlas-design/store.json
 * - Vercel without Supabase                                       -> /tmp store, clearly marked NOT durable
 */
export function backend(): Backends {
  if (backends) return backends;
  const e = env();
  const wantSupabase = e.ATLAS_PERSISTENCE === "supabase" || (e.ATLAS_PERSISTENCE === "auto" && supabaseConfigured());
  if (wantSupabase) {
    if (!supabaseConfigured())
      throw new AppError("ATLAS_PERSISTENCE=supabase but Supabase credentials are missing.", 500, "config");
    const client = createSupabaseServerClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.SUPABASE_SERVICE_ROLE_KEY!);
    backends = { repo: new SupabaseRepository(client), blobs: new SupabaseBlobStore(client), dataDir: null };
  } else if (isVercel() && !e.ATLAS_DATA_DIR) {
    const dir = path.join(os.tmpdir(), "atlas-design");
    backends = { repo: new LocalJsonRepository(dir, { ephemeral: true }), blobs: new LocalBlobStore(dir), dataDir: dir };
  } else {
    const dir = dataDir();
    backends = { repo: new LocalJsonRepository(dir), blobs: new LocalBlobStore(dir), dataDir: dir };
  }
  return backends;
}

export const repo = () => backend().repo;
export const blobs = () => backend().blobs;

/** For tests only. */
export function __setBackends(b: Backends | null) {
  backends = b;
}
