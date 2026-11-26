import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { describe, expect, it } from "vitest";
import { COLLECTION_NAMES } from "@/modules/core/schemas";
import { repo } from "@/modules/persistence";
import { TABLES, __test } from "@/modules/persistence/supabase-store";
import { recordReview } from "@/modules/review/service";
import { startSession, submitChoice } from "@/modules/selections/service";
import { saveRoomSpec } from "@/modules/spatial/service";
import { freshBackends, useBrowser } from "./helpers/env";
import { LIB, seedLibrary } from "./helpers/scenario";

/**
 * Runs the Supabase migrations on a real Postgres engine (PGlite) and inserts every record the
 * app actually produces, mapped exactly as the Supabase adapter maps them. This proves the SQL
 * is valid and that column names and types match the TypeScript schema.
 */
describe("Supabase migrations", () => {
  it("apply cleanly and accept every record type the app writes", async () => {
    const db = new PGlite({ extensions: { vector } });
    // Stubs for objects Supabase provides
    await db.exec(`create role anon; create role authenticated; create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`);
    const dir = path.resolve(import.meta.dirname, "../supabase/migrations");
    for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(path.join(dir, f), "utf8"));
    const buckets = await db.query<{ id: string; public: boolean }>("select id, public from storage.buckets order by id");
    expect(buckets.rows.map((b) => b.id)).toEqual(["floor-plans", "generated-images", "reference-images", "reference-thumbnails", "source-documents", "supporting-assets"]);
    expect(buckets.rows.every((b) => b.public === false)).toBe(true);

    // Produce real data through the services
    freshBackends();
    useBrowser("mig");
    const { ids } = await seedLibrary(LIB);
    const s = await startSession({ propertyId: "prop_andheri_atlas", floorPlanId: "fp_andheri_sample", offeringId: "off_demo_premium" });
    await submitChoice(s.id, { roomId: "rm_meeting_1", referenceId: ids[0] });
    await submitChoice(s.id, { roomId: "rm_meeting_1", referenceId: ids[3] });
    await saveRoomSpec(s.id, "rm_meeting_1", { unit: "m", length: 4, width: 4, height: 3, roomTypeId: "rt_meeting", occupancy: 4 });
    await recordReview({ sessionId: s.id, roomId: "rm_meeting_1", generatedAssetId: null, action: "comment", comment: "ok" });

    // Insert in dependency order using the adapter's own column mapping
    const order = ["roomTypes", "materials", "offerings", "boqItems", "properties", "floorPlans", "settings", "projects", "sourceDocuments", "references", "designDirections", "designSessions", "selections", "selectionRevisions", "roomSpecs", "generationJobs", "generatedAssets", "designerReviews", "auditLog"] as const;
    expect([...order].sort()).toEqual([...COLLECTION_NAMES].sort());
    let inserted = 0;
    for (const c of order) {
      for (const rec of await repo().list(c)) {
        const row = Object.fromEntries(Object.entries(rec as Record<string, unknown>).map(([k, v]) => [__test.toSnake(k), v]));
        const cols = Object.keys(row);
        const vals = cols.map((k) => (row[k] !== null && typeof row[k] === "object" ? JSON.stringify(row[k]) : row[k]));
        await db.query(`insert into ${TABLES[c]} (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})`, vals);
        inserted++;
      }
    }
    expect(inserted).toBeGreaterThan(20);
    const seq1 = await db.query<{ v: string }>("select atlas_next_sequence('reference') as v");
    const seq2 = await db.query<{ v: string }>("select atlas_next_sequence('reference') as v");
    expect(Number(seq2.rows[0].v)).toBe(Number(seq1.rows[0].v) + 1);
    // Unique revision constraint protects against duplicate revision numbers
    const rev = (await repo().list("selectionRevisions"))[0];
    await expect(db.query(`insert into selection_revisions (id, selection_id, session_id, room_id, room_type_id, reference_id, snapshot, offering_id, revision) values ('dup', $1, $2, $3, $4, $5, '{}', $6, $7)`, [rev.selectionId, rev.sessionId, rev.roomId, rev.roomTypeId, rev.referenceId, rev.offeringId, rev.revision])).rejects.toThrow(/duplicate key/);
    const rls = await db.query<{ n: number }>("select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity");
    expect(rls.rows[0].n).toBe(0);
    await db.close();
  });
});
