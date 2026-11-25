"use client";
import { Check, Combine, Pencil, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/api";
import { Button, ErrorNote, inputCls, Pill, Spinner, StageBadge, Swatches } from "@/components/ui";
import type { portfolioIntelligence } from "@/modules/intelligence/library";
import type { DesignDirection } from "@/modules/core/schemas";

type Intel = Awaited<ReturnType<typeof portfolioIntelligence>>;

function DirectionRow({ d, onChange, checked, onCheck }: { d: DesignDirection; onChange: () => void; checked: boolean; onCheck: (v: boolean) => void }) {
  const [name, setName] = useState(d.name);
  const [desc, setDesc] = useState(d.description);
  const [editing, setEditing] = useState(false);
  const save = async (status = d.status) => {
    await api(`/api/directions/${d.id}`, { method: "PATCH", json: { name, description: desc, status, referenceIds: d.referenceIds, signature: d.signature, source: d.source } });
    setEditing(false);
    onChange();
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-stone-100">
      <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label="Select for combining" />
      <Swatches palette={d.signature.palette.map((hex) => ({ hex }))} />
      {editing ? (
        <div className="flex flex-1 gap-2">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          <input className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} />
          <Button size="sm" onClick={() => save()}><Save className="size-3.5" /></Button>
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="font-medium">{d.name} <Pill tone={d.status === "approved" ? "good" : d.status === "archived" ? "neutral" : "warn"}>{d.status}</Pill> <Pill>{d.source}</Pill></p>
          <p className="text-xs text-stone-600">{d.description} · {d.referenceIds.length} references · {d.signature.materials.join(", ")}</p>
        </div>
      )}
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => setEditing((x) => !x)}><Pencil className="size-3.5" /> Rename</Button>
        {d.status !== "approved" && <Button size="sm" variant="secondary" onClick={() => save("approved")}><Check className="size-3.5" /> Approve</Button>}
        {d.status !== "archived" && <Button size="sm" variant="ghost" onClick={() => save("archived")}>Archive</Button>}
        <Button size="sm" variant="ghost" className="text-danger" onClick={async () => { if (!confirm(`Delete direction "${d.name}"?`)) return; await api(`/api/directions/${d.id}`, { method: "DELETE" }); onChange(); }}><Trash2 className="size-3.5" /></Button>
      </div>
    </div>
  );
}

export default function IntelligencePage() {
  const [d, setD] = useState<Intel | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [mergeName, setMergeName] = useState("");
  const load = useCallback(() => api<Intel>("/api/intelligence").then(setD).catch((e) => setErr(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);
  if (err) return <ErrorNote error={err} />;
  if (!d) return <Spinner />;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl">Design intelligence</h1>
        <p className="text-sm text-stone-600">Patterns across the whole portfolio, computed from reviewed metadata and sampled colours. Every result names the attributes behind it.</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <Pill>{d.totals.projects} projects</Pill>
          <Pill>{d.totals.references} references</Pill>
          <Pill tone="good">{d.totals.approved} approved</Pill>
          <Pill tone="warn">{d.totals.pending} awaiting review</Pill>
          <span className="inline-flex items-center gap-2">Semantic (vector) search <StageBadge state="planned" /></span>
        </div>
        <p className="mt-1 text-[11px] text-stone-400">{d.semanticSearch.reason}</p>
      </div>

      <section className="space-y-3">
        <h2 className="font-display text-xl">Suggested design directions</h2>
        <p className="text-xs text-stone-600">Grouped from {d.discovery.usable} references with enough metadata ({d.discovery.skipped} skipped). {d.discovery.note}</p>
        <div className="grid gap-3 md:grid-cols-2">
          {d.discovery.suggestions.map((s) => (
            <div key={s.name + s.referenceIds[0]} className="planned-outline space-y-2 rounded-2xl bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium">{s.name}</p>
                <Swatches palette={s.signature.palette.map((hex) => ({ hex }))} />
              </div>
              <p className="text-xs text-stone-600">{s.description} Cohesion {Math.round(s.cohesion * 100)}%.</p>
              <Button size="sm" variant="secondary" onClick={async () => { await api("/api/directions", { method: "POST", json: { name: s.name, description: s.description, status: "suggested", source: "discovered", referenceIds: s.referenceIds, signature: s.signature } }); load(); }}>
                Save as a direction for review
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-xl">Design directions</h2>
          {sel.length >= 2 && (
            <div className="flex gap-2">
              <input className={inputCls} placeholder="Name for combined direction" value={mergeName} onChange={(e) => setMergeName(e.target.value)} />
              <Button size="sm" disabled={!mergeName} onClick={async () => { await api("/api/directions/merge", { method: "POST", json: { ids: sel, name: mergeName } }); setSel([]); setMergeName(""); load(); }}>
                <Combine className="size-3.5" /> Combine {sel.length}
              </Button>
            </div>
          )}
        </div>
        {d.directions.length === 0 && <p className="text-sm text-stone-600">No directions yet. Save a suggestion above, then approve or rename it.</p>}
        {d.directions.map((x) => (
          <DirectionRow key={x.id} d={x} onChange={load} checked={sel.includes(x.id)} onCheck={(v) => setSel((s) => (v ? [...s, x.id] : s.filter((y) => y !== x.id)))} />
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 font-display text-xl">Recurring across projects</h2>
          {d.recurring.length === 0 && <p className="text-sm text-stone-600">No attribute appears in two or more projects yet.</p>}
          <ul className="space-y-1.5">
            {d.recurring.slice(0, 25).map((p) => (
              <li key={p.kind + p.label} className="rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-stone-100">
                <b>{p.label}</b> <span className="text-xs text-stone-600">({p.kind})</span>
                <p className="text-xs text-stone-600">{p.projectNames.join(", ")} · {p.referenceIds.length} references</p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="mb-2 font-display text-xl">Unique to one project</h2>
          {d.unique.length === 0 && <p className="text-sm text-stone-600">Nothing yet.</p>}
          <ul className="space-y-2">
            {d.unique.map((u) => (
              <li key={u.projectId} className="rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-stone-100">
                <b>{u.projectName}</b>
                <p className="text-xs text-stone-600">{u.traits.slice(0, 12).map((t) => `${t.value} (${t.kind})`).join(" · ")}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
