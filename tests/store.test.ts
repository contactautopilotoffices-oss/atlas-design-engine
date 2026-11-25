import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalJsonRepository } from "@/modules/persistence/local-json-store";
import { freshBackends } from "./helpers/env";

const audit = (i: number) => ({ id: `a${i}`, action: "t", actor: "x", entity: "e", entityId: null, details: {}, at: new Date().toISOString() });

describe("local JSON store (.atlas-design/store.json)", () => {
  it("writes atomically to store.json and survives a restart (new instance)", async () => {
    const { repo, dataDir } = freshBackends();
    await repo.insert("auditLog", audit(1));
    const file = path.join(dataDir, "store.json");
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).format).toBe("atlas-design-store");
    const restarted = new LocalJsonRepository(dataDir);
    expect(await restarted.get("auditLog", "a1")).toMatchObject({ id: "a1" });
    expect(existsSync(path.join(dataDir, "store.lock"))).toBe(false);
  });

  it("does not lose writes under heavy concurrency in one process", async () => {
    const { repo } = freshBackends();
    await Promise.all(Array.from({ length: 60 }, (_, i) => repo.insert("auditLog", audit(i))));
    expect((await repo.list("auditLog")).length).toBe(60);
  });

  it("hands out unique sequence numbers across two server processes sharing the file", async () => {
    const { dataDir } = freshBackends();
    const a = new LocalJsonRepository(dataDir);
    const b = new LocalJsonRepository(dataDir);
    const nums = await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? a : b).nextSequence("reference")));
    expect(new Set(nums).size).toBe(40);
    expect(Math.max(...nums)).toBe(40);
  });

  it("rejects duplicate ids and unknown updates", async () => {
    const { repo } = freshBackends();
    await repo.insert("auditLog", audit(1));
    await expect(repo.insert("auditLog", audit(1))).rejects.toThrow(/Duplicate/);
    await expect(repo.update("auditLog", "nope", {})).rejects.toThrow(/not found/);
  });
});
