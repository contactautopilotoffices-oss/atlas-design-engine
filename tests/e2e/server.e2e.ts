/**
 * End-to-end test against the real production server (next start).
 * Covers: staff auth, upload (PDF + PPTX + image), review/approval, client gallery visibility,
 * session start, Submit Choice, server RESTART, persistence in .atlas-design/store.json,
 * revisions, ownership, asset access control, generation guard rails, page rendering.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { testPng } from "../helpers/env";
import { makePdf, makePptx } from "../helpers/fixtures";

const PORT = 3123;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = mkdtempSync(path.join(os.tmpdir(), "atlas-e2e-"));
let server: ChildProcess | null = null;

async function start() {
  try {
    await fetch(`${BASE}/api/status`);
    throw new Error(`Port ${PORT} is already in use by another server; stop it first.`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Port")) throw e;
  }
  const root = path.resolve(import.meta.dirname, "../..");
  server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT)], {
    cwd: root,
    detached: true,
    env: { ...process.env, NODE_ENV: "production", ATLAS_DATA_DIR: DATA, ATLAS_ADMIN_PASSCODE: "admin-pass", ATLAS_DESIGNER_PASSCODE: "designer-pass", ATLAS_SESSION_SECRET: "e2e-secret-e2e-secret", HIGGSFIELF_API_KEY: "", HF_API_KEY_ID: "", HIGGSFIELD_API_KEY: "", OPENAI_API_KEY: "" },
    stdio: "ignore",
  });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/api/status`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start");
}
async function stop() {
  if (!server) return;
  const s = server;
  server = null;
  await new Promise<void>((r) => {
    s.on("exit", () => r());
    process.kill(-s.pid!, "SIGTERM"); // whole process group, so no Next.js worker survives
  });
  // Prove the server is really gone before continuing.
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`${BASE}/api/status`);
      await new Promise((r) => setTimeout(r, 250));
    } catch {
      return;
    }
  }
  throw new Error("server did not stop");
}

/** Tiny cookie-aware client, one per "browser". */
function browser() {
  const jar = new Map<string, string>();
  return async (url: string, init: RequestInit & { json?: unknown } = {}) => {
    const headers = new Headers(init.headers);
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    if (init.json !== undefined) headers.set("content-type", "application/json");
    const res = await fetch(BASE + url, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const [k, ...v] = kv.split("=");
      jar.set(k, v.join("="));
    }
    return res;
  };
}

afterAll(stop);

describe("ATLAS Design Engine end-to-end (production server)", () => {
  const admin = browser();
  const client = browser();
  const stranger = browser();
  let projectId = "";
  let sessionId = "";
  let meetingRefs: Array<{ id: string; thumbUrl: string }> = [];

  it("starts and reports honest status", async () => {
    await start();
    const s = await (await fetch(`${BASE}/api/status`)).json();
    expect(s.persistence.kind).toBe("local-json");
    expect(s.features.find((f: { key: string }) => f.key === "higgsfield").state).toBe("built-awaiting-config");
    expect(s.features.find((f: { key: string }) => f.key === "client-flow").state).toBe("live");
  }, 90_000);

  it("protects Studio with staff passcodes", async () => {
    expect((await admin("/api/projects")).status).toBe(401);
    expect((await admin("/api/staff/session", { method: "POST", json: { passcode: "wrong" } })).status).toBe(401);
    expect((await admin("/api/staff/session", { method: "POST", json: { passcode: "admin-pass" } })).status).toBe(200);
    expect((await admin("/api/projects")).status).toBe(200);
    const designer = browser();
    await designer("/api/staff/session", { method: "POST", json: { passcode: "designer-pass" } });
    expect((await designer("/api/projects", { method: "POST", json: { name: "x" } })).status).toBe(403);
  });

  it("uploads PDF, PPTX and image files and extracts source-linked references", async () => {
    projectId = (await (await admin("/api/projects", { method: "POST", json: { name: "Volt", propertyName: "Sky Tower", city: "Mumbai" } })).json()).project.id;
    const fd = new FormData();
    fd.append("files", new Blob([new Uint8Array(await makePdf())], { type: "application/pdf" }), "volt.pdf");
    fd.append("files", new Blob([new Uint8Array(await makePptx())]), "deck.pptx");
    fd.append("files", new Blob([new Uint8Array(await testPng("#123456", "#abcdef"))]), "photo.png");
    fd.append("files", new Blob([new Uint8Array(Buffer.from("hello"))]), "notes.txt");
    const res = await (await admin(`/api/projects/${projectId}/upload`, { method: "POST", body: fd })).json();
    const by = Object.fromEntries(res.results.map((r: { filename: string }) => [r.filename, r]));
    expect(by["volt.pdf"]).toMatchObject({ ok: true, status: "processed", createdReferences: 3 });
    expect(by["deck.pptx"]).toMatchObject({ ok: true, status: "partial", createdReferences: 2 }); // EMF vector skipped and reported
    expect(by["photo.png"]).toMatchObject({ ok: true, createdReferences: 1 });
    expect(by["notes.txt"]).toMatchObject({ ok: false, status: "rejected" });
    const all = (await (await admin("/api/references")).json()).references;
    expect(all.length).toBe(6);
    expect(all.find((r: { source: { filename: string; page: number } }) => r.source.filename === "volt.pdf" && r.source.page === 1)).toBeTruthy();
  });

  it("only shows approved references to clients, after review", async () => {
    expect((await (await client("/api/references")).json()).total).toBe(0);
    const all = (await (await admin("/api/references")).json()).references;
    for (const r of all.slice(0, 3)) {
      const md = { ...r.metadata, roomTypeId: "rt_meeting", designLanguage: "Modern Minimal", materials: { ...r.metadata.materials, flooring: ["Natural Wood"] } };
      expect((await admin(`/api/references/${r.id}`, { method: "PATCH", json: { metadata: md, reviewStatus: "approved" } })).status).toBe(200);
    }
    const visible = (await (await client("/api/references?roomTypeId=rt_meeting&offeringId=off_demo_premium")).json()).references;
    expect(visible.length).toBe(3);
    meetingRefs = visible;
    expect((await client(visible[0].thumbUrl)).status).toBe(200);
    const pending = all.find((r: { id: string }) => !visible.some((v: { id: string }) => v.id === r.id));
    expect((await client(pending.thumbUrl)).status).toBe(403);
    const doc = (await (await admin(`/api/projects/${projectId}`)).json()).documents[0];
    expect((await client(`/api/assets/source-documents/${doc.blobKey}`)).status).toBe(403);
    expect((await admin(`/api/assets/source-documents/${doc.blobKey}`)).status).toBe(200);
  });

  it("client opens the property, submits a choice; submitting never generates", async () => {
    const s = await (await client("/api/sessions", { method: "POST", json: { propertyId: "prop_andheri_atlas", floorPlanId: "fp_andheri_sample", offeringId: "off_demo_premium", clientName: "Acme" } })).json();
    sessionId = s.session.id;
    expect(s.session.ownerTokenHash).toBeUndefined();
    const sub = await (await client(`/api/sessions/${sessionId}/selections`, { method: "POST", json: { roomId: "rm_meeting_1", referenceId: meetingRefs[0].id } })).json();
    expect(sub.selection.revision).toBe(1);
    expect((await (await admin("/api/generation/jobs")).json()).jobs).toHaveLength(0);
    const store = JSON.parse(readFileSync(path.join(DATA, "store.json"), "utf8"));
    expect(store.collections.selections[0]).toMatchObject({ roomId: "rm_meeting_1", roomTypeId: "rt_meeting", referenceId: meetingRefs[0].id, offeringId: "off_demo_premium", sessionId, revision: 1 });
    expect(store.collections.selections[0].snapshot.projectName).toBe("Volt");
    expect(store.collections.selections[0].submittedAt).toBeTruthy();
  });

  it("keeps submitted choices across a server restart, then records a new revision", async () => {
    await stop();
    await start();
    const sum = await (await client(`/api/sessions/${sessionId}`)).json();
    const room = sum.rooms.find((r: { room: { id: string } }) => r.room.id === "rm_meeting_1");
    expect(room.selection).toMatchObject({ referenceId: meetingRefs[0].id, revision: 1 });
    await client(`/api/sessions/${sessionId}/selections`, { method: "POST", json: { roomId: "rm_meeting_1", referenceId: meetingRefs[1].id } });
    const after = (await (await client(`/api/sessions/${sessionId}`)).json()).rooms.find((r: { room: { id: string } }) => r.room.id === "rm_meeting_1");
    expect(after.selection.revision).toBe(2);
    expect(after.revisions.map((r: { revision: number }) => r.revision)).toEqual([2, 1]);
  }, 120_000);

  it("blocks other browsers from a client's session", async () => {
    expect((await stranger(`/api/sessions/${sessionId}`)).status).toBe(403);
    expect((await stranger(`/api/sessions/${sessionId}/selections`, { method: "POST", json: { roomId: "rm_meeting_1", referenceId: meetingRefs[0].id } })).status).toBe(403);
  });

  it("guards generation: confirmation, room measurements, provider configuration", async () => {
    const body = { modelId: "xai/grok-imagine-image-2.0", roles: [] };
    expect((await client(`/api/sessions/${sessionId}/rooms/rm_meeting_1/generate`, { method: "POST", json: body })).status).toBe(400);
    // Popup options work straight from the floor plan size; with no Higgsfield key, generation is refused honestly.
    const opts = await (await client(`/api/sessions/${sessionId}/rooms/rm_meeting_1/options`)).json();
    expect(opts.library.length).toBe(3);
    expect(opts.ai.available).toBe(false);
    const r0 = await client(`/api/sessions/${sessionId}/rooms/rm_meeting_1/options`, { method: "POST", json: { confirmed: true } });
    expect(r0.status).toBe(503);
    const bad = await client(`/api/sessions/${sessionId}/rooms/rm_meeting_1/spec`, { method: "PUT", json: { unit: "m", length: 4, width: 4, height: 1.5, roomTypeId: "rt_meeting", occupancy: 4 } });
    expect((await bad.json()).record.isValid).toBe(false);
    const r1 = await client(`/api/sessions/${sessionId}/rooms/rm_meeting_1/generate`, { method: "POST", json: { ...body, confirmed: true } });
    expect(r1.status).toBe(409);
    await client(`/api/sessions/${sessionId}/rooms/rm_meeting_1/spec`, { method: "PUT", json: { unit: "m", length: 4, width: 4, height: 3, roomTypeId: "rt_meeting", occupancy: 4, doors: [{ id: "d", wall: "south", offset: 0.5, width: 1, height: 2.1, sillHeight: 0 }] } });
    const r2 = await client(`/api/sessions/${sessionId}/rooms/rm_meeting_1/generate`, { method: "POST", json: { ...body, confirmed: true } });
    expect(r2.status).toBe(503);
    expect((await r2.json()).error).toMatch(/No Higgsfield credential/);
    const preview = await (await client(`/api/sessions/${sessionId}/rooms/rm_meeting_1/brief`, { method: "POST", json: { roles: [] } })).json();
    expect(preview.prompt.prompt).toContain("4 x 4 m with a 3 m ceiling");
  });

  it("renders every page", async () => {
    for (const p of ["/", "/library", `/atlas/${sessionId}`, `/atlas/${sessionId}/preview`, `/atlas/${sessionId}/rooms/rm_meeting_1/space`, `/atlas/${sessionId}/rooms/rm_meeting_1/visualise`, `/handoff/${sessionId}`, "/studio", "/studio/projects", "/studio/review", "/studio/admin"]) {
      const res = await client(p);
      expect(res.status, p).toBe(200);
      expect(await res.text()).toContain("ATLAS");
    }
  });
});
