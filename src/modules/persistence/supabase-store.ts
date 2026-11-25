import "server-only";
/**
 * Supabase persistence adapter (cloud, durable).
 *
 * Maps each collection to a table created by supabase/migrations. Top-level camelCase
 * fields map to snake_case columns; nested blocks are jsonb columns. Uses the
 * service-role key, so it must only ever run on the server.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CollectionName, RecordOf } from "@/modules/core/schemas";
import { AppError } from "@/modules/core/util";
import type { BlobBucket, BlobStore, Repository } from "./types";

export const TABLES: Record<CollectionName, string> = {
  roomTypes: "room_types",
  materials: "materials",
  offerings: "offerings",
  properties: "properties",
  floorPlans: "floor_plans",
  settings: "app_settings",
  projects: "projects",
  sourceDocuments: "source_documents",
  references: "reference_assets",
  designDirections: "design_directions",
  designSessions: "design_sessions",
  selections: "design_selections",
  selectionRevisions: "selection_revisions",
  roomSpecs: "room_specs",
  generationJobs: "generation_jobs",
  generatedAssets: "generated_assets",
  designerReviews: "designer_reviews",
  auditLog: "audit_log",
};

const toSnake = (k: string) => k.replace(/[A-Z0-9]/g, (m, i) => (i === 0 ? m.toLowerCase() : `_${m.toLowerCase()}`)).replace(/_(\d)/g, "$1");
const toCamel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const rowOut = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [toCamel(k), v]));
const rowIn = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [toSnake(k), v]));

export const __test = { toSnake, toCamel };

function fail(op: string, error: { message: string; code?: string } | null): never {
  throw new AppError(`Cloud database ${op} failed${error?.code ? ` (${error.code})` : ""}.`, 502, "supabase_error");
}

export class SupabaseRepository implements Repository {
  readonly kind = "supabase" as const;
  readonly durable = true;
  constructor(readonly client: SupabaseClient) {}

  async list<C extends CollectionName>(c: C, where?: Partial<RecordOf<C>>) {
    let q = this.client.from(TABLES[c]).select("*");
    for (const [k, v] of Object.entries(where ?? {})) q = q.eq(toSnake(k), v as never);
    const { data, error } = await q;
    if (error) fail("read", error);
    return (data ?? []).map((r) => rowOut(r) as RecordOf<C>);
  }

  async get<C extends CollectionName>(c: C, id: string) {
    const { data, error } = await this.client.from(TABLES[c]).select("*").eq("id", id).maybeSingle();
    if (error) fail("read", error);
    return data ? (rowOut(data) as RecordOf<C>) : null;
  }

  async insert<C extends CollectionName>(c: C, rec: RecordOf<C>) {
    const { data, error } = await this.client.from(TABLES[c]).insert(rowIn(rec as Record<string, unknown>)).select().single();
    if (error) fail("insert", error);
    return rowOut(data) as RecordOf<C>;
  }

  async update<C extends CollectionName>(c: C, id: string, patch: Partial<RecordOf<C>>) {
    const { data, error } = await this.client
      .from(TABLES[c])
      .update(rowIn(patch as Record<string, unknown>))
      .eq("id", id)
      .select()
      .single();
    if (error) fail("update", error);
    return rowOut(data) as RecordOf<C>;
  }

  async remove<C extends CollectionName>(c: C, id: string) {
    const { error } = await this.client.from(TABLES[c]).delete().eq("id", id);
    if (error) fail("delete", error);
  }

  async nextSequence(name: string) {
    const { data, error } = await this.client.rpc("atlas_next_sequence", { seq_name: name });
    if (error) fail("sequence", error);
    return Number(data);
  }

  /** Serialised through a Postgres advisory lock held by the atlas_with_lock RPC is not possible
   *  across HTTP calls, so writes rely on unique constraints (e.g. selection revisions) instead. */
  exclusive<T>(_key: string, fn: () => Promise<T>) {
    return fn();
  }
}

export class SupabaseBlobStore implements BlobStore {
  readonly kind = "supabase-storage" as const;
  constructor(readonly client: SupabaseClient) {}

  async put(bucket: BlobBucket, key: string, data: Buffer, contentType: string) {
    const { error } = await this.client.storage.from(bucket).upload(key, data, { contentType, upsert: true });
    if (error) throw new AppError("Cloud storage upload failed.", 502, "storage_error");
  }

  async get(bucket: BlobBucket, key: string) {
    const { data, error } = await this.client.storage.from(bucket).download(key);
    if (error || !data) return null;
    return { data: Buffer.from(await data.arrayBuffer()), contentType: data.type || "application/octet-stream" };
  }

  async remove(bucket: BlobBucket, key: string) {
    await this.client.storage.from(bucket).remove([key]);
  }

  /** Short-lived signed URL for private assets. */
  async signedUrl(bucket: BlobBucket, key: string, seconds = 300) {
    const { data, error } = await this.client.storage.from(bucket).createSignedUrl(key, seconds);
    if (error || !data) return null;
    return data.signedUrl;
  }
}

export function createSupabaseServerClient(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
