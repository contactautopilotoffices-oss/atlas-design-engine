"use client";
import { Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, deleteResource } from "@/components/api";
import { Button, cx, ErrorNote, Field, inputCls, Pill, Spinner } from "@/components/ui";
import type { AppSettings, AuditEntry, FloorPlan, Material, Offering, Property, RoomType } from "@/modules/core/schemas";
import { ALL_MODELS } from "@/modules/generation/models";

const TABS = ["Offerings", "Room types", "Materials", "Properties & floor plans", "AI prompt", "Demo content", "Users & permissions", "Audit log"] as const;
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function useItems<T>(collection: string) {
  const [items, setItems] = useState<T[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api<{ items: T[] }>(`/api/admin/${collection}`).then((d) => setItems(d.items)).catch((e) => setErr(e.message)), [collection]);
  useEffect(() => {
    load();
  }, [load]);
  const save = async (id: string | null, body: unknown) => {
    setErr(null);
    try {
      if (id) await api(`/api/admin/${collection}/${id}`, { method: "PATCH", json: body });
      else await api(`/api/admin/${collection}`, { method: "POST", json: body });
      await load();
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    }
  };
  const remove = async (id: string) => {
    setErr(null);
    try {
      if (await deleteResource(`/api/admin/${collection}/${id}`, "Delete this item?")) await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return { items, err, save, remove, load };
}

function OfferingEditor({ o, roomTypes, onSave, onDelete }: { o: Partial<Offering>; roomTypes: RoomType[]; onSave: (b: Partial<Offering>) => void; onDelete?: () => void }) {
  const [x, setX] = useState<Partial<Offering>>(o);
  const rules = x.rules ?? { mode: "all-approved", roomTypeIds: [], excludedMaterialNames: [], includeReferenceIds: [], excludeReferenceIds: [], inheritLowerTiers: false, requireApproved: true };
  const setR = (p: Partial<typeof rules>) => setX({ ...x, rules: { ...rules, ...p } });
  return (
    <div className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-stone-100">
      <div className="grid gap-2 sm:grid-cols-[2fr_3fr_80px]">
        <Field label="Name"><input className={inputCls} value={x.name ?? ""} onChange={(e) => setX({ ...x, name: e.target.value })} /></Field>
        <Field label="Description"><input className={inputCls} value={x.description ?? ""} onChange={(e) => setX({ ...x, description: e.target.value })} /></Field>
        <Field label="Rank"><input type="number" className={inputCls} value={x.rank ?? 0} onChange={(e) => setX({ ...x, rank: Number(e.target.value) })} /></Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Which references are eligible" hint="Tagged = only references tagged for this offering in review.">
          <select className={inputCls} value={rules.mode} onChange={(e) => setR({ mode: e.target.value as "tagged" | "all-approved" })}>
            <option value="all-approved">All approved references</option>
            <option value="tagged">Only references tagged for this offering</option>
          </select>
        </Field>
        <Field label="Materials not included (comma separated)"><input className={inputCls} value={rules.excludedMaterialNames.join(", ")} onChange={(e) => setR({ excludedMaterialNames: list(e.target.value) })} /></Field>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-stone-600">Room types included (none ticked = all)</p>
        <div className="flex flex-wrap gap-3">
          {roomTypes.map((t) => (
            <label key={t.id} className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={rules.roomTypeIds.includes(t.id)} onChange={(e) => setR({ roomTypeIds: e.target.checked ? [...rules.roomTypeIds, t.id] : rules.roomTypeIds.filter((i) => i !== t.id) })} /> {t.name}
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Always include reference IDs (ref_…)"><input className={inputCls} value={rules.includeReferenceIds.join(", ")} onChange={(e) => setR({ includeReferenceIds: list(e.target.value) })} /></Field>
        <Field label="Always exclude reference IDs"><input className={inputCls} value={rules.excludeReferenceIds.join(", ")} onChange={(e) => setR({ excludeReferenceIds: list(e.target.value) })} /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-1"><input type="checkbox" checked={rules.inheritLowerTiers} onChange={(e) => setR({ inheritLowerTiers: e.target.checked })} /> Also include lower-ranked offerings&apos; tagged references</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={rules.requireApproved} onChange={(e) => setR({ requireApproved: e.target.checked })} /> Approved references only</label>
        {x.isDemo && <Pill tone="warn">demo offering</Pill>}
        <div className="ml-auto flex gap-2">
          {onDelete && <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="size-3.5" /> Delete</Button>}
          <Button size="sm" onClick={() => onSave({ ...x, rules })}><Save className="size-3.5" /> Save</Button>
        </div>
      </div>
    </div>
  );
}

function RoomTypeEditor({ t, onSave, onDelete }: { t: Partial<RoomType>; onSave: (b: Partial<RoomType>) => void; onDelete?: () => void }) {
  const [x, setX] = useState<Partial<RoomType>>(t);
  const p = x.spatialProfile ?? { minSeats: null, maxSeats: null, purposeKeywords: [], tableArrangements: [], areaPerPersonM2: null };
  const setP = (q: Partial<typeof p>) => setX({ ...x, spatialProfile: { ...p, ...q } });
  const n = (v: string) => (v === "" ? null : Number(v));
  return (
    <div className="grid items-end gap-2 rounded-2xl bg-white p-3 ring-1 ring-stone-100 lg:grid-cols-[1.2fr_1.5fr_70px_70px_80px_1.6fr_1.2fr_auto]">
      <Field label="Name"><input className={inputCls} value={x.name ?? ""} onChange={(e) => setX({ ...x, name: e.target.value })} /></Field>
      <Field label="Description"><input className={inputCls} value={x.description ?? ""} onChange={(e) => setX({ ...x, description: e.target.value })} /></Field>
      <Field label="Min seats"><input type="number" className={inputCls} value={p.minSeats ?? ""} onChange={(e) => setP({ minSeats: n(e.target.value) })} /></Field>
      <Field label="Max seats"><input type="number" className={inputCls} value={p.maxSeats ?? ""} onChange={(e) => setP({ maxSeats: n(e.target.value) })} /></Field>
      <Field label="m2/person"><input type="number" step="0.1" className={inputCls} value={p.areaPerPersonM2 ?? ""} onChange={(e) => setP({ areaPerPersonM2: n(e.target.value) })} /></Field>
      <Field label="Purpose keywords"><input className={inputCls} value={p.purposeKeywords.join(", ")} onChange={(e) => setP({ purposeKeywords: list(e.target.value) })} /></Field>
      <Field label="Table arrangements"><input className={inputCls} value={p.tableArrangements.join(", ")} onChange={(e) => setP({ tableArrangements: list(e.target.value) })} /></Field>
      <div className="flex gap-1 pb-0.5">
        {onDelete && <Button size="sm" variant="ghost" onClick={onDelete} aria-label="Delete"><Trash2 className="size-3.5" /></Button>}
        <Button size="sm" onClick={() => onSave({ ...x, spatialProfile: p })}><Save className="size-3.5" /></Button>
      </div>
    </div>
  );
}

function JsonEditor<T extends { id: string }>({ item, onSave, onDelete }: { item: T; onSave: (b: unknown) => Promise<boolean>; onDelete?: () => void }) {
  const [text, setText] = useState(JSON.stringify(item, null, 2));
  const [bad, setBad] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <textarea className={cx(inputCls, "h-72 font-mono text-xs")} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {bad && <p className="text-xs text-danger">{bad}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={async () => { try { setBad(null); await onSave(JSON.parse(text)); } catch { setBad("That is not valid JSON."); } }}><Save className="size-3.5" /> Save</Button>
        {onDelete && <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="size-3.5" /> Delete</Button>}
      </div>
    </div>
  );
}

function PromptSettings({ s, providers, onSave }: { s: AppSettings; providers?: { higgsfield: { configured: boolean }; openai?: { configured: boolean } }; onSave: (b: Partial<AppSettings>) => void }) {
  const [instr, setInstr] = useState(s.promptInstructions.join("\n"));
  const [neg, setNeg] = useState(s.negativePrompt);
  const [defModel, setDefModel] = useState(s.defaultModelId);
  return (
    <>
      <Field label="Generation instructions (one per line)" hint="Added to every brief after the room, spatial and design sections.">
        <textarea className={cx(inputCls, "h-40")} value={instr} onChange={(e) => setInstr(e.target.value)} />
      </Field>
      <Field label="Negative prompt" hint="Only sent to models that document support for it."><input className={inputCls} value={neg} onChange={(e) => setNeg(e.target.value)} /></Field>
      <Field label="Default model" hint="Switch between OpenAI and Higgsfield models here. Providers without a configured key fall back automatically if another is configured.">
        <select className={inputCls} value={defModel} onChange={(e) => setDefModel(e.target.value)}>
          {ALL_MODELS.map((m) => {
            const p = m.provider ?? "higgsfield";
            const ready = p === "openai" ? providers?.openai?.configured : providers?.higgsfield?.configured;
            return (
              <option key={m.id} value={m.id}>
                {m.label}{providers ? (ready ? " (configured)" : " (key not set)") : ""}
              </option>
            );
          })}
        </select>
      </Field>
      <Button onClick={() => onSave({ promptInstructions: instr.split("\n").map((l) => l.trim()).filter(Boolean), negativePrompt: neg, defaultModelId: defModel })}><Save className="size-4" /> Save</Button>
    </>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>(() => (typeof window !== "undefined" && window.location.hash === "#audit" ? "Audit log" : "Offerings"));
  const offerings = useItems<Offering>("offerings");
  const roomTypes = useItems<RoomType>("roomTypes");
  const materials = useItems<Material>("materials");
  const properties = useItems<Property>("properties");
  const floorPlans = useItems<FloorPlan>("floorPlans");
  const settings = useItems<AppSettings>("settings");
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [demoMsg, setDemoMsg] = useState<string | null>(null);
  const [newMat, setNewMat] = useState({ name: "", category: "" });
  const [status, setStatus] = useState<{ staffAuth: { configured: boolean; openDevAccess: boolean }; higgsfield: { configured: boolean }; openai?: { configured: boolean } } | null>(null);
  useEffect(() => {
    if (tab === "Audit log") api<{ entries: AuditEntry[] }>("/api/admin/audit").then((d) => setAudit(d.entries)).catch(() => undefined);
    if (tab === "Users & permissions" || tab === "AI prompt") api<typeof status>("/api/status").then(setStatus).catch(() => undefined);
  }, [tab]);
  const s = settings.items?.[0];

  const errors = [offerings.err, roomTypes.err, materials.err, properties.err, floorPlans.err, settings.err].filter(Boolean)[0] ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl">Administration</h1>
        <p className="text-sm text-stone-600">Business rules and configuration. Nothing here is hardcoded in the app.</p>
      </div>
      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx("rounded-full px-3 py-1.5 text-sm", tab === t ? "bg-ink text-paper" : "bg-white ring-1 ring-stone-100 hover:ring-stone-200")}>{t}</button>
        ))}
      </div>
      <ErrorNote error={errors} />

      {tab === "Offerings" && (
        <div className="space-y-3">
          <p className="text-sm text-stone-600">An offering decides which references, room types and materials a client can choose from.</p>
          {!offerings.items || !roomTypes.items ? <Spinner /> : offerings.items.sort((a, b) => a.rank - b.rank).map((o) => (
            <OfferingEditor key={o.id + o.updatedAt} o={o} roomTypes={roomTypes.items!} onSave={(b) => offerings.save(o.id, b)} onDelete={() => offerings.remove(o.id)} />
          ))}
          {roomTypes.items && <details className="rounded-2xl bg-stone-50 p-3"><summary className="cursor-pointer text-sm font-medium"><Plus className="inline size-4" /> New offering</summary><div className="mt-3"><OfferingEditor o={{ name: "", description: "", rank: (offerings.items?.length ?? 0) + 1 }} roomTypes={roomTypes.items} onSave={(b) => offerings.save(null, b)} /></div></details>}
        </div>
      )}

      {tab === "Room types" && (
        <div className="space-y-2">
          <p className="text-sm text-stone-600">Seats, keywords, arrangements and area per person are the signals used to check room classification. They are guidelines, never a single size cut-off.</p>
          {!roomTypes.items ? <Spinner /> : roomTypes.items.sort((a, b) => a.sortOrder - b.sortOrder).map((t) => <RoomTypeEditor key={t.id + t.updatedAt} t={t} onSave={(b) => roomTypes.save(t.id, b)} onDelete={() => roomTypes.remove(t.id)} />)}
          <p className="pt-2 text-sm font-medium">Add a room type</p>
          <RoomTypeEditor t={{ name: "", description: "", sortOrder: roomTypes.items?.length ?? 0 }} onSave={(b) => roomTypes.save(null, b)} />
        </div>
      )}

      {tab === "Materials" && (
        <div className="space-y-3">
          <p className="text-sm text-stone-600">Optional catalogue of material names, used to keep naming consistent across reviews and offering rules.</p>
          <div className="flex gap-2">
            <input className={inputCls} placeholder="Material name" value={newMat.name} onChange={(e) => setNewMat({ ...newMat, name: e.target.value })} />
            <input className={inputCls} placeholder="Category (e.g. flooring)" value={newMat.category} onChange={(e) => setNewMat({ ...newMat, category: e.target.value })} />
            <Button disabled={!newMat.name} onClick={async () => { if (await materials.save(null, { name: newMat.name, category: newMat.category || "general" })) setNewMat({ name: "", category: "" }); }}><Plus className="size-4" /> Add</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {materials.items?.map((m) => (
              <span key={m.id} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm ring-1 ring-stone-100">{m.name} <span className="text-xs text-stone-400">{m.category}</span><button onClick={() => materials.remove(m.id)} aria-label="Delete"><Trash2 className="size-3 text-stone-400" /></button></span>
            ))}
          </div>
        </div>
      )}

      {tab === "Properties & floor plans" && (
        <div className="space-y-5">
          <div className="space-y-2">
            <h2 className="font-display text-xl">Properties</h2>
            {properties.items?.map((p) => (
              <details key={p.id} className="rounded-2xl bg-white p-3 ring-1 ring-stone-100">
                <summary className="cursor-pointer text-sm"><b>{p.name}</b> · {p.city} {p.isDemo && <Pill tone="warn">demo</Pill>}</summary>
                <div className="mt-2"><JsonEditor item={p} onSave={(b) => properties.save(p.id, b)} onDelete={() => properties.remove(p.id)} /></div>
              </details>
            ))}
            <Button size="sm" variant="secondary" onClick={() => properties.save(null, { name: "New property", city: "", address: "", isDemo: false })}><Plus className="size-3.5" /> Add property</Button>
          </div>
          <div className="space-y-2">
            <h2 className="font-display text-xl">Floor plans</h2>
            <p className="text-xs text-stone-600">Rooms are polygons in plan units (metres or feet). Mark any layout that is not surveyed geometry as a sample (isSample: true) so clients see the notice.</p>
            {floorPlans.items?.map((f) => (
              <details key={f.id + f.updatedAt} className="rounded-2xl bg-white p-3 ring-1 ring-stone-100">
                <summary className="cursor-pointer text-sm"><b>{f.name}</b> · {f.rooms.length} rooms {f.isSample && <Pill tone="warn">sample</Pill>}</summary>
                <div className="mt-2"><JsonEditor item={f} onSave={(b) => floorPlans.save(f.id, b)} onDelete={() => floorPlans.remove(f.id)} /></div>
              </details>
            ))}
            {properties.items?.[0] && (
              <Button size="sm" variant="secondary" onClick={() => floorPlans.save(null, { propertyId: properties.items![0].id, name: "New floor plan", isSample: true, sampleNotice: "Sample layout.", unit: "m", width: 10, height: 8, rooms: [{ id: `rm_${Date.now()}`, code: "R-01", name: "Room 1", roomTypeId: roomTypes.items?.[0]?.id ?? "rt_meeting", polygon: [[0, 0], [5, 0], [5, 4], [0, 4]], dimensions: null }] })}>
                <Plus className="size-3.5" /> Add floor plan (template)
              </Button>
            )}
          </div>
        </div>
      )}

      {tab === "AI prompt" && (
        <div className="space-y-3 rounded-3xl bg-white p-5 ring-1 ring-stone-100">
          {!s ? <Spinner /> : <PromptSettings key={s.updatedAt} s={s} providers={status ?? undefined} onSave={(b) => settings.save("app", b)} />}
        </div>
      )}

      {tab === "Demo content" && (
        <div className="space-y-3 rounded-3xl bg-white p-5 ring-1 ring-stone-100">
          <p className="text-sm">Load two synthetic demo projects with six drawn images, each stamped <b>DEMO IMAGE: NOT A REAL PROJECT</b>, so the full client flow can be shown before real presentations are uploaded. Remove them with one click.</p>
          <div className="flex gap-2">
            <Button onClick={async () => setDemoMsg((await api<{ message: string }>("/api/admin/demo", { method: "POST" })).message)}>Load demo content</Button>
            <Button variant="secondary" onClick={async () => setDemoMsg(`Removed ${(await api<{ removed: number }>("/api/admin/demo", { method: "DELETE" })).removed} demo project(s).`)}>Remove demo content</Button>
          </div>
          {demoMsg && <p className="text-sm text-live">{demoMsg}</p>}
        </div>
      )}

      {tab === "Users & permissions" && (
        <div className="space-y-3 rounded-3xl bg-white p-5 text-sm ring-1 ring-stone-100">
          <p><b>Client</b>: no sign-in. Each browser gets a private session token; it can only open its own design sessions and generated images, and only sees approved references.</p>
          <p><b>Designer</b>: passcode in <code>ATLAS_DESIGNER_PASSCODE</code>. Reviews references, approves generated images, comments.</p>
          <p><b>Admin</b>: passcode in <code>ATLAS_ADMIN_PASSCODE</code>. Everything above plus uploads, configuration and demo content.</p>
          {status && (status.staffAuth.openDevAccess ? <p className="text-planned">No passcodes are set, so Studio is open in local development. In production Studio stays locked until a passcode is configured.</p> : <p className="text-live">Staff passcodes are configured.</p>)}
          <p className="text-xs text-stone-600">Individual user accounts (Supabase Auth) are a planned upgrade once the app moves into the main ATLAS platform.</p>
        </div>
      )}

      {tab === "Audit log" && (
        <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-stone-100" id="audit">
          {!audit ? <div className="p-5"><Spinner /></div> : (
            <table className="w-full text-xs">
              <thead className="bg-stone-50 text-left text-stone-600"><tr>{["When", "Action", "Actor", "Entity", "Details"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id} className="border-t border-stone-100"><td className="px-3 py-1.5 whitespace-nowrap">{new Date(a.at).toLocaleString()}</td><td className="px-3 py-1.5">{a.action}</td><td className="px-3 py-1.5">{a.actor}</td><td className="px-3 py-1.5">{a.entity} {a.entityId}</td><td className="px-3 py-1.5 font-mono text-[10px] text-stone-600">{JSON.stringify(a.details)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
