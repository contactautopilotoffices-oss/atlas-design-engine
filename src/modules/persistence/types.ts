import type { CollectionName, RecordOf } from "@/modules/core/schemas";

export type PersistenceKind = "local-json" | "supabase" | "ephemeral-tmp";

/**
 * Storage abstraction used by every service. The UI never talks to a storage
 * implementation directly, so the local JSON adapter can be swapped for Supabase
 * (or the main ATLAS platform's database) without UI changes.
 */
export interface Repository {
  readonly kind: PersistenceKind;
  /** True when data survives restarts and redeploys in the current environment. */
  readonly durable: boolean;
  list<C extends CollectionName>(c: C, where?: Partial<RecordOf<C>>): Promise<RecordOf<C>[]>;
  get<C extends CollectionName>(c: C, id: string): Promise<RecordOf<C> | null>;
  insert<C extends CollectionName>(c: C, rec: RecordOf<C>): Promise<RecordOf<C>>;
  update<C extends CollectionName>(c: C, id: string, patch: Partial<RecordOf<C>>): Promise<RecordOf<C>>;
  remove<C extends CollectionName>(c: C, id: string): Promise<void>;
  /** Monotonic counter, e.g. for REF-00001 codes. */
  nextSequence(name: string): Promise<number>;
  /**
   * Run a read-modify-write unit exclusively. The local adapter holds a process
   * mutex plus a lock file, so concurrent requests cannot interleave writes.
   */
  exclusive<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

export type BlobBucket =
  | "source-documents"
  | "reference-images"
  | "reference-thumbnails"
  | "floor-plans"
  | "generated-images"
  | "supporting-assets";

export interface BlobStore {
  readonly kind: "local-fs" | "supabase-storage";
  put(bucket: BlobBucket, key: string, data: Buffer, contentType: string): Promise<void>;
  get(bucket: BlobBucket, key: string): Promise<{ data: Buffer; contentType: string } | null>;
  remove(bucket: BlobBucket, key: string): Promise<void>;
}
