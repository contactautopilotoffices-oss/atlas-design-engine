/**
 * Local development persistence: .atlas-design/store.json
 *
 * - Atomic writes: data is written to a temp file, fsynced, then renamed over store.json.
 * - In-process mutex serialises every write in this server process.
 * - A lock directory (store.lock) guards against a second process writing at the same time.
 * - Every write re-reads the file under the lock, so no update is lost.
 *
 * This is NOT a production database. On Vercel the filesystem is temporary; use Supabase there.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { promises as fs } from "node:fs";
import path from "node:path";
import { COLLECTION_NAMES, type CollectionName, type RecordOf } from "@/modules/core/schemas";
import { AppError, sleep } from "@/modules/core/util";
import type { PersistenceKind, Repository } from "./types";

type StoreFile = {
  format: "atlas-design-store";
  version: 1;
  updatedAt: string;
  sequences: Record<string, number>;
  collections: { [K in CollectionName]: RecordOf<K>[] };
};

const emptyStore = (): StoreFile => ({
  format: "atlas-design-store",
  version: 1,
  updatedAt: new Date().toISOString(),
  sequences: {},
  collections: Object.fromEntries(COLLECTION_NAMES.map((c) => [c, []])) as unknown as StoreFile["collections"],
});

export class LocalJsonRepository implements Repository {
  readonly kind: PersistenceKind;
  readonly durable: boolean;
  private readonly file: string;
  private readonly lockDir: string;
  private chain: Promise<unknown> = Promise.resolve();
  private cache: { mtimeMs: number; size: number; data: StoreFile } | null = null;
  /** Tracks whether the current async call chain already holds the lock (re-entrancy). */
  private readonly held = new AsyncLocalStorage<boolean>();

  constructor(
    readonly dataDir: string,
    opts: { ephemeral?: boolean } = {},
  ) {
    this.file = path.join(dataDir, "store.json");
    this.lockDir = path.join(dataDir, "store.lock");
    this.kind = opts.ephemeral ? "ephemeral-tmp" : "local-json";
    this.durable = !opts.ephemeral;
  }

  get filePath() {
    return this.file;
  }

  private async read(): Promise<StoreFile> {
    let stat;
    try {
      stat = await fs.stat(this.file);
    } catch {
      return emptyStore();
    }
    if (this.cache && this.cache.mtimeMs === stat.mtimeMs && this.cache.size === stat.size) return this.cache.data;
    const raw = await fs.readFile(this.file, "utf8");
    let data: StoreFile;
    try {
      data = JSON.parse(raw) as StoreFile;
    } catch {
      throw new AppError(`The local store at ${this.file} is not valid JSON. Restore it from a backup or remove it.`, 500, "store_corrupt");
    }
    if (data.format !== "atlas-design-store") throw new AppError("Unrecognised local store format.", 500, "store_corrupt");
    for (const c of COLLECTION_NAMES) {
      if (!Array.isArray(data.collections[c])) (data.collections as Record<string, unknown[]>)[c] = [];
    }
    data.sequences ??= {};
    this.cache = { mtimeMs: stat.mtimeMs, size: stat.size, data };
    return data;
  }

  private async write(data: StoreFile) {
    data.updatedAt = new Date().toISOString();
    await fs.mkdir(this.dataDir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    const handle = await fs.open(tmp, "w");
    try {
      await handle.writeFile(JSON.stringify(data, null, 2), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, this.file);
    this.cache = null;
  }

  private async acquireFileLock() {
    await fs.mkdir(this.dataDir, { recursive: true });
    const deadline = Date.now() + 10_000;
    for (;;) {
      try {
        await fs.mkdir(this.lockDir);
        return;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        try {
          const st = await fs.stat(this.lockDir);
          if (Date.now() - st.mtimeMs > 30_000) await fs.rm(this.lockDir, { recursive: true, force: true }); // stale lock
        } catch {
          /* lock released meanwhile */
        }
        if (Date.now() > deadline) throw new AppError("The local store is busy. Please try again.", 503, "store_busy");
        await sleep(25 + Math.random() * 50);
      }
    }
  }

  /** Serialise within the process and across processes. Re-entrant for nested calls. */
  exclusive<T>(_key: string, fn: () => Promise<T>): Promise<T> {
    if (this.held.getStore()) return fn();
    const run = async () => {
      await this.acquireFileLock();
      try {
        return await this.held.run(true, fn);
      } finally {
        await fs.rm(this.lockDir, { recursive: true, force: true });
      }
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private mutate<T>(fn: (data: StoreFile) => T): Promise<T> {
    return this.exclusive("store", async () => {
      this.cache = null;
      const data = await this.read();
      const result = fn(data);
      await this.write(data);
      return result;
    });
  }

  async list<C extends CollectionName>(c: C, where?: Partial<RecordOf<C>>) {
    const data = await this.read();
    const rows = data.collections[c] as RecordOf<C>[];
    const filtered = where
      ? rows.filter((r) => Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v))
      : rows;
    return structuredClone(filtered);
  }

  async get<C extends CollectionName>(c: C, id: string) {
    const data = await this.read();
    const row = (data.collections[c] as RecordOf<C>[]).find((r) => (r as { id: string }).id === id);
    return row ? structuredClone(row) : null;
  }

  insert<C extends CollectionName>(c: C, rec: RecordOf<C>) {
    return this.mutate((data) => {
      const rows = data.collections[c] as RecordOf<C>[];
      if (rows.some((r) => (r as { id: string }).id === (rec as { id: string }).id))
        throw new AppError(`Duplicate id in ${c}.`, 409, "conflict");
      rows.push(structuredClone(rec));
      return structuredClone(rec);
    });
  }

  update<C extends CollectionName>(c: C, id: string, patch: Partial<RecordOf<C>>) {
    return this.mutate((data) => {
      const rows = data.collections[c] as RecordOf<C>[];
      const i = rows.findIndex((r) => (r as { id: string }).id === id);
      if (i < 0) throw new AppError(`Record ${id} not found in ${c}.`, 404, "not_found");
      rows[i] = { ...rows[i], ...structuredClone(patch), id } as RecordOf<C>;
      return structuredClone(rows[i]);
    });
  }

  remove<C extends CollectionName>(c: C, id: string) {
    return this.mutate((data) => {
      const rows = data.collections[c] as RecordOf<C>[];
      (data.collections as Record<string, unknown[]>)[c] = rows.filter((r) => (r as { id: string }).id !== id);
    });
  }

  nextSequence(name: string) {
    return this.mutate((data) => {
      const n = (data.sequences[name] ?? 0) + 1;
      data.sequences[name] = n;
      return n;
    });
  }
}
