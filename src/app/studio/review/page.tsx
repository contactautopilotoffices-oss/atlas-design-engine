"use client";
import { Check, CircleHelp, Save, Sparkles, Trash2, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { api, deleteResource } from "@/components/api";
import { sourceLabel, useConfig, type ReferenceView } from "@/components/references";
import { Button, cx, Empty, ErrorNote, Field, inputCls, Modal, Pill, Spinner, Swatches } from "@/components/ui";
import type { ReferenceMetadata } from "@/modules/core/schemas";

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const str = (xs: string[]) => xs.join(", ");
const nul = (s: string) => (s.trim() ? s.trim() : null);

function Editor({ r, offerings, roomTypes, directions, aiConfigured, onSaved, onDeleted }: { r: ReferenceView; offerings: Array<{ id: string; name: string }>; roomTypes: Array<{ id: string; name: string }>; directions: Array<{ id: string; name: string }>; aiConfigured?: boolean; onSaved: (r: ReferenceView) => void; onDeleted: (id: string) => void }) {
  const [m, setM] = useState<ReferenceMetadata>(r.metadata);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof ReferenceMetadata>(k: K, v: ReferenceMetadata[K]) => setM((x) => ({ ...x, [k]: v }));
  const text = (label: string, value: string | null, on: (v: string) => void, ph = "") => (
    <Field label={label}><input className={inputCls} value={value ?? ""} placeholder={ph} onChange={(e) => on(e.target.value)} /></Field>
  );

  async function save(reviewStatus?: "approved" | "rejected" | "needs_review") {
    setBusy(reviewStatus ?? "save");
    setErr(null);
    try {
      const d = await api<{ reference: ReferenceView }>(`/api/references/${r.id}`, { method: "PATCH", json: { metadata: m, reviewStatus } });
      onSaved(d.reference);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setErr(null);
    try {
      if (await deleteResource(`/api/references/${r.id}`, `Permanently delete ${r.referenceCode} (${sourceLabel(r)})?`)) {
        onDeleted(r.id);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function analyse() {
    setBusy("analyse");
    setErr(null);
    try {
      const d = await api<{ reference: ReferenceView }>(`/api/references/${r.id}/analyse`, { method: "POST" });
      setM(d.reference.metadata);
      onSaved(d.reference);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const prov = (k: string) => r.provenance[k];
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl bg-ink">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={r.imageUrl} alt="" className="mx-auto max-h-[46vh] object-contain" />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <b>{r.referenceCode}</b> · {r.project.name} · {sourceLabel(r)} <Pill tone={r.reviewStatus === "approved" ? "good" : r.reviewStatus === "rejected" ? "bad" : "warn"}>{r.reviewStatus}</Pill>
        <Pill>{r.width} x {r.height}px</Pill>
        <Pill tone={r.analysis.status === "completed" ? "good" : r.analysis.status === "failed" ? "bad" : "warn"}>
          AI analysis: {r.analysis.status.replace("_", " ")}{r.analysis.provider ? ` (${r.analysis.provider})` : ""}
        </Pill>
        {r.analysis.imageRole && <Pill>{r.analysis.imageRole.replace("_", " ")}</Pill>}
        {aiConfigured && (
          <Button size="sm" variant="secondary" onClick={analyse} loading={busy === "analyse"}>
            <Sparkles className="size-3.5" /> {r.analysis.status === "completed" ? "Re-analyse with AI" : "Analyse with AI"}
          </Button>
        )}
      </div>
      {r.analysis.summary && <p className="rounded-xl bg-[#f4ece0] p-2 text-xs text-ink"><b>AI summary:</b> {r.analysis.summary}</p>}
      {r.analysis.error && <p className="rounded-xl bg-danger-soft p-2 text-xs text-danger">AI error: {r.analysis.error}</p>}
      {r.sourceText && <p className="rounded-xl bg-stone-50 p-2 text-xs text-stone-600"><b>Text on this page:</b> {r.sourceText.slice(0, 400)}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Room type">
          <select className={inputCls} value={m.roomTypeId ?? ""} onChange={(e) => set("roomTypeId", e.target.value || null)}>
            <option value="">Not classified</option>
            {roomTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Design direction">
          <select className={inputCls} value={m.designDirectionId ?? ""} onChange={(e) => set("designDirectionId", e.target.value || null)}>
            <option value="">None</option>
            {directions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        {text("Design language / style", m.designLanguage, (v) => set("designLanguage", nul(v)), "e.g. Modern Minimal")}
        {text("Visual characteristics", str(m.visualCharacteristics), (v) => set("visualCharacteristics", list(v)), "comma separated")}
        {text("Architectural language", m.architecturalLanguage, (v) => set("architecturalLanguage", nul(v)))}
        {text("Design intent (interpretation)", m.designIntent, (v) => set("designIntent", nul(v)))}
      </div>

      <fieldset className="rounded-2xl bg-stone-50 p-3">
        <legend className="px-1 text-xs font-medium">Colours {prov("colors.primary") === "observed" && <Pill tone="good">sampled from pixels</Pill>}</legend>
        <div className="flex flex-wrap items-center gap-3">
          <Swatches palette={m.colors.palette} size="md" />
          {(["primary", "secondary", "tertiary"] as const).map((k) => (
            <label key={k} className="flex items-center gap-1 text-xs">
              <input type="color" value={m.colors[k] ?? "#ffffff"} onChange={(e) => set("colors", { ...m.colors, [k]: e.target.value.toUpperCase() })} />
              {k === "tertiary" ? "accent" : k} {m.colors[k]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="grid gap-2 rounded-2xl bg-stone-50 p-3 sm:grid-cols-3">
        <legend className="px-1 text-xs font-medium">Materials (comma separated)</legend>
        {(["flooring", "walls", "ceiling", "furniture", "surfaces", "other"] as const).map((k) => (
          <Field key={k} label={k}><input className={inputCls} value={str(m.materials[k])} onChange={(e) => set("materials", { ...m.materials, [k]: list(e.target.value) })} /></Field>
        ))}
      </fieldset>

      <fieldset className="grid gap-2 rounded-2xl bg-stone-50 p-3 sm:grid-cols-3">
        <legend className="px-1 text-xs font-medium">Lighting</legend>
        {(["natural", "artificial", "ambient", "accent"] as const).map((k) => (
          <Field key={k} label={k}><input className={inputCls} value={m.lighting[k] ?? ""} onChange={(e) => set("lighting", { ...m.lighting, [k]: nul(e.target.value) })} /></Field>
        ))}
        <Field label="Colour temperature (K, estimate)"><input type="number" className={inputCls} value={m.lighting.temperatureK ?? ""} onChange={(e) => set("lighting", { ...m.lighting, temperatureK: e.target.value ? Math.round(Number(e.target.value)) : null })} /></Field>
      </fieldset>

      <fieldset className="grid gap-2 rounded-2xl bg-stone-50 p-3 sm:grid-cols-2">
        <legend className="px-1 text-xs font-medium">Furniture and layout</legend>
        <Field label="Furniture types"><input className={inputCls} value={str(m.furniture.types)} onChange={(e) => set("furniture", { ...m.furniture, types: list(e.target.value) })} /></Field>
        <Field label="Arrangement"><input className={inputCls} value={m.furniture.arrangement ?? ""} onChange={(e) => set("furniture", { ...m.furniture, arrangement: nul(e.target.value) })} /></Field>
        <Field label="Partitions"><input className={inputCls} value={m.furniture.partitions ?? ""} onChange={(e) => set("furniture", { ...m.furniture, partitions: nul(e.target.value) })} /></Field>
        <Field label="Doors and windows visible"><input className={inputCls} value={m.furniture.doorsWindows ?? ""} onChange={(e) => set("furniture", { ...m.furniture, doorsWindows: nul(e.target.value) })} /></Field>
        <Field label="Spatial composition"><input className={inputCls} value={m.furniture.composition ?? ""} onChange={(e) => set("furniture", { ...m.furniture, composition: nul(e.target.value) })} /></Field>
        <Field label="Distinctive elements"><input className={inputCls} value={str(m.furniture.distinctiveElements)} onChange={(e) => set("furniture", { ...m.furniture, distinctiveElements: list(e.target.value) })} /></Field>
      </fieldset>

      <fieldset className="grid gap-2 rounded-2xl bg-stone-50 p-3 sm:grid-cols-3">
        <legend className="px-1 text-xs font-medium">Classification</legend>
        <Field label="Design category"><input className={inputCls} value={m.classification.designCategory ?? ""} onChange={(e) => set("classification", { ...m.classification, designCategory: nul(e.target.value) })} /></Field>
        <Field label="Tags"><input className={inputCls} value={str(m.classification.tags)} onChange={(e) => set("classification", { ...m.classification, tags: list(e.target.value) })} /></Field>
        <Field label="Keywords"><input className={inputCls} value={str(m.classification.keywords)} onChange={(e) => set("classification", { ...m.classification, keywords: list(e.target.value) })} /></Field>
        <div className="sm:col-span-3">
          <p className="mb-1 text-xs font-medium text-stone-600">Tagged offerings</p>
          <div className="flex flex-wrap gap-3">
            {offerings.map((o) => (
              <label key={o.id} className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={m.classification.offeringIds.includes(o.id)} onChange={(e) => set("classification", { ...m.classification, offeringIds: e.target.checked ? [...m.classification.offeringIds, o.id] : m.classification.offeringIds.filter((x) => x !== o.id) })} />
                {o.name}
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className="grid gap-2 rounded-2xl bg-stone-50 p-3 sm:grid-cols-6">
        <legend className="px-1 text-xs font-medium">Dimensions (only from drawings, supplied measurements or verified text; never from the photo)</legend>
        {(["length", "width", "height"] as const).map((k) => (
          <Field key={k} label={k}><input type="number" className={inputCls} value={m.dimensions[k] ?? ""} onChange={(e) => set("dimensions", { ...m.dimensions, [k]: e.target.value ? Number(e.target.value) : null })} /></Field>
        ))}
        <Field label="Unit"><select className={inputCls} value={m.dimensions.unit} onChange={(e) => set("dimensions", { ...m.dimensions, unit: e.target.value as "m" | "ft" })}><option>m</option><option>ft</option></select></Field>
        <Field label="Source">
          <select className={inputCls} value={m.dimensions.source ?? ""} onChange={(e) => set("dimensions", { ...m.dimensions, source: (e.target.value || null) as ReferenceMetadata["dimensions"]["source"] })}>
            <option value="">None</option>
            <option value="architectural-drawing">Architectural drawing</option>
            <option value="supplied-measurement">Supplied measurement</option>
            <option value="verified-source-text">Verified source text</option>
          </select>
        </Field>
        <Field label="Confidence">
          <select className={inputCls} value={m.dimensions.confidence ?? ""} onChange={(e) => set("dimensions", { ...m.dimensions, confidence: (e.target.value || null) as ReferenceMetadata["dimensions"]["confidence"] })}>
            <option value="">-</option><option>high</option><option>medium</option><option>low</option>
          </select>
        </Field>
      </fieldset>
      <Field label="Reviewer notes"><textarea className={inputCls} rows={2} value={m.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      <ErrorNote error={err} />
      <div className="sticky bottom-0 flex flex-wrap gap-2 bg-canvas/95 py-3 backdrop-blur">
        <Button onClick={() => save("approved")} loading={busy === "approved"} disabled={!m.roomTypeId}><Check className="size-4" /> Save and approve</Button>
        <Button variant="secondary" onClick={() => save()} loading={busy === "save"}><Save className="size-4" /> Save</Button>
        <Button variant="secondary" onClick={() => save("needs_review")} loading={busy === "needs_review"}><CircleHelp className="size-4" /> Needs review</Button>
        <Button variant="ghost" onClick={() => save("rejected")} loading={busy === "rejected"}><X className="size-4" /> Reject</Button>
        <Button variant="danger" onClick={remove} loading={busy === "delete"} className="ml-auto"><Trash2 className="size-4" /> Delete</Button>
        {!m.roomTypeId && <span className="self-center text-xs text-planned">Set a room type before approving.</span>}
      </div>
    </div>
  );
}

type RT = { id: string; name: string };

/** One picture at a time: one click sets the room type and approves, or hides it. */
function QuickReview({ projectId, roomTypes, aiConfigured, onDetails }: { projectId: string; roomTypes: RT[]; aiConfigured?: boolean; onDetails: (r: ReferenceView) => void }) {
  const [queue, setQueue] = useState<ReferenceView[] | null>(null);
  const [done, setDone] = useState({ approved: 0, hidden: 0 });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    const q = new URLSearchParams({ reviewStatus: "pending" });
    if (projectId) q.set("projectId", projectId);
    api<{ references: ReferenceView[] }>(`/api/references?${q}`).then((d) => setQueue(d.references)).catch((e) => setErr(e.message));
  }, [projectId]);
  useEffect(load, [load]);

  const send = async (items: Array<{ id: string; roomTypeId: string | null }>) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ approved: number; hidden: number }>("/api/references/quick-review", { method: "POST", json: { items } });
      setDone((d) => ({ approved: d.approved + r.approved, hidden: d.hidden + r.hidden }));
      const ids = new Set(items.map((i) => i.id));
      setQueue((q) => q?.filter((x) => !ids.has(x.id)) ?? null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeCurrent = async (ref: ReferenceView) => {
    setBusy(true);
    setErr(null);
    try {
      if (await deleteResource(`/api/references/${ref.id}`, `Permanently delete ${ref.referenceCode}?`)) {
        setQueue((q) => q?.filter((x) => x.id !== ref.id) ?? null);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const analysePending = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/references/analyse", { method: "POST", json: { projectId: projectId || undefined, onlyUnanalysed: true, reviewStatus: "pending" } });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!queue) return err ? <ErrorNote error={err} /> : <Spinner />;
  const current = queue[0];
  const suggested = queue.filter((r) => r.suggestion.likelyNotDesign || r.suggestion.roomTypeId);
  const unanalysedCount = queue.filter((r) => r.analysis.status !== "completed").length;
  const nameOf = (id: string | null) => roomTypes.find((r) => r.id === id)?.name ?? "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-stone-100">
        <p className="text-sm"><b>{queue.length}</b> pictures left to review · {done.approved} approved · {done.hidden} hidden</p>
        <div className="ml-auto flex flex-wrap gap-2">
          {aiConfigured && unanalysedCount > 0 && (
            <Button size="sm" variant="secondary" loading={busy} onClick={analysePending}>
              <Sparkles className="size-4" /> Analyse {unanalysedCount} with AI
            </Button>
          )}
          {suggested.length > 0 && (
            <Button
              size="sm"
              loading={busy}
              onClick={() => {
                const n = suggested.filter((r) => !r.suggestion.likelyNotDesign).length;
                const h = suggested.length - n;
                if (confirm(`Approve ${n} picture(s) with their suggested room type and hide ${h} non-design/small picture(s) (key plans, logos, mood boards)? You can change any of them later.`))
                  send(suggested.map((r) => ({ id: r.id, roomTypeId: r.suggestion.likelyNotDesign ? null : r.suggestion.roomTypeId })));
              }}
            >
              <Check className="size-4" /> Accept all {suggested.length} suggestions
            </Button>
          )}
        </div>
      </div>
      <ErrorNote error={err} />
      {!current && <Empty title="All done">Every picture in this project has been reviewed. Clients can now see the approved ones.</Empty>}
      {current && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3 rounded-3xl bg-white p-4 ring-1 ring-stone-100">
            <div className="flex h-[52vh] items-center justify-center overflow-hidden rounded-2xl bg-ink">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={current.imageUrl} alt="" className="max-h-full max-w-full object-contain" />
            </div>
            <p className="text-xs text-stone-600">
              {current.project.name} · {sourceLabel(current)} · {current.width} x {current.height}px
              {current.sourceText && <> · <i>&ldquo;{current.sourceText.slice(0, 80)}&rdquo;</i></>}
            </p>
            {current.analysis.summary && (
              <p className="rounded-xl bg-[#f4ece0] px-2.5 py-1.5 text-xs text-ink">
                <b>AI:</b> {current.analysis.summary}
              </p>
            )}
            <p className="text-sm font-medium">What room is this?</p>
            <div className="flex flex-wrap gap-2">
              {roomTypes.map((rt) => {
                const isSuggested = !current.suggestion.likelyNotDesign && current.suggestion.roomTypeId === rt.id;
                return (
                  <button
                    key={rt.id}
                    disabled={busy}
                    onClick={() => send([{ id: current.id, roomTypeId: rt.id }])}
                    className={cx("rounded-full px-4 py-2 text-sm transition disabled:opacity-50", isSuggested ? "bg-ink text-paper" : "bg-stone-100 hover:bg-stone-200")}
                  >
                    {rt.name}
                    {isSuggested && <span className="ml-2 text-[10px] uppercase tracking-wide opacity-70">suggested</span>}
                  </button>
                );
              })}
              <button
                disabled={busy}
                onClick={() => send([{ id: current.id, roomTypeId: null }])}
                className={cx("rounded-full px-4 py-2 text-sm transition disabled:opacity-50", current.suggestion.likelyNotDesign ? "bg-danger text-white" : "bg-danger-soft text-danger hover:opacity-80")}
              >
                Not a design (hide)
                {current.suggestion.likelyNotDesign && <span className="ml-2 text-[10px] uppercase tracking-wide opacity-80">suggested</span>}
              </button>
              <button
                disabled={busy}
                onClick={() => removeCurrent(current)}
                className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-3 py-2 text-sm text-danger hover:bg-danger-soft disabled:opacity-50"
              >
                <Trash2 className="size-3.5" /> Delete permanently
              </button>
            </div>
            <div className="flex items-center gap-3 pt-1 text-xs">
              <button className="text-stone-600 underline" onClick={() => onDetails(current)}>Add more details (optional)</button>
              {current.suggestion.roomTypeId && !current.suggestion.likelyNotDesign && <span className="text-stone-400">Suggested &ldquo;{nameOf(current.suggestion.roomTypeId)}&rdquo; because the page says &ldquo;{current.suggestion.matched}&rdquo;.</span>}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-stone-600">Up next</p>
            <div className="grid max-h-[70vh] grid-cols-2 gap-2 overflow-auto pr-1">
              {queue.slice(1, 41).map((r) => (
                <div key={r.id} className="overflow-hidden rounded-xl bg-white ring-1 ring-stone-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.thumbUrl} alt="" className="block h-24 w-full object-cover" />
                  <p className="truncate px-2 py-1 text-[11px] text-stone-600">
                    {r.suggestion.likelyNotDesign ? "Small picture" : nameOf(r.suggestion.roomTypeId) || "No suggestion"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Review() {
  const params = useSearchParams();
  const { config } = useConfig();
  const [projectId, setProjectId] = useState(params.get("projectId") ?? "");
  const [mode, setMode] = useState<"quick" | "all">("quick");
  const [status, setStatus] = useState("approved");
  const [refs, setRefs] = useState<ReferenceView[] | null>(null);
  const [current, setCurrent] = useState<ReferenceView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    if (mode !== "all") return;
    const q = new URLSearchParams();
    if (status) q.set("reviewStatus", status);
    if (projectId) q.set("projectId", projectId);
    api<{ references: ReferenceView[] }>(`/api/references?${q}`).then((d) => setRefs(d.references)).catch((e) => setErr(e.message));
  }, [status, projectId, mode]);
  useEffect(load, [load]);
  if (!config) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Reference review</h1>
          <p className="text-sm text-stone-600">Tell the app which room each picture shows. Only approved pictures reach clients.</p>
        </div>
        <div className="flex gap-2">
          <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">All projects</option>
            {config.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="flex rounded-full bg-white p-1 ring-1 ring-stone-200">
            {(["quick", "all"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={cx("rounded-full px-3 py-1 text-sm", mode === m ? "bg-ink text-paper" : "text-stone-600")}>
                {m === "quick" ? "To review" : "All pictures"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {mode === "quick" && <QuickReview key={projectId} projectId={projectId} roomTypes={config.roomTypes} aiConfigured={config.aiVisionConfigured} onDetails={(r) => setCurrent(r)} />}

      {mode === "all" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${inputCls} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="approved">Approved</option>
              <option value="rejected">Hidden / rejected</option>
              <option value="pending">Pending</option>
              <option value="needs_review">Needs review</option>
              <option value="">All</option>
            </select>
            {status === "rejected" && refs && refs.length > 0 && (
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  if (!confirm(`Permanently delete all ${refs.length} hidden/rejected picture(s)?`)) return;
                  setErr(null);
                  try {
                    for (const r of refs) await api(`/api/references/${r.id}`, { method: "DELETE" });
                    load();
                  } catch (e) {
                    setErr((e as Error).message);
                  }
                }}
              >
                <Trash2 className="size-3.5" /> Delete all hidden ({refs.length})
              </Button>
            )}
          </div>
          <ErrorNote error={err} />
          {refs && refs.length === 0 && <Empty title="Nothing here">No pictures match this filter.</Empty>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {refs?.map((r) => (
              <div key={r.id} className="group relative overflow-hidden rounded-xl bg-white ring-1 ring-stone-100 hover:ring-bronze">
                <button onClick={() => setCurrent(r)} className="block w-full text-left">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.thumbUrl} alt="" className="block h-28 w-full object-cover" />
                  <p className="truncate px-2 py-1 text-[11px]">{r.roomTypeName ?? "No room type"} · {r.referenceCode}</p>
                </button>
                <button
                  aria-label={`Delete ${r.referenceCode}`}
                  onClick={async () => {
                    setErr(null);
                    try {
                      if (await deleteResource(`/api/references/${r.id}`, `Permanently delete ${r.referenceCode}?`)) {
                        setRefs((rs) => rs?.filter((x) => x.id !== r.id) ?? null);
                      }
                    } catch (e) {
                      setErr((e as Error).message);
                    }
                  }}
                  className="absolute right-1.5 top-1.5 rounded-full bg-white/90 p-1 text-stone-500 opacity-0 shadow transition hover:text-danger group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <Modal open={Boolean(current)} onClose={() => setCurrent(null)} wide title="Picture details">
        <div className="p-6">
          {current && (
            <Editor
              key={current.id}
              r={current}
              offerings={config.offerings}
              roomTypes={config.roomTypes}
              directions={config.directions}
              aiConfigured={config.aiVisionConfigured}
              onSaved={(r) => {
                setCurrent(r);
                setRefs((rs) => rs?.map((x) => (x.id === r.id ? r : x)) ?? null);
              }}
              onDeleted={(id) => {
                setCurrent(null);
                setRefs((rs) => rs?.filter((x) => x.id !== id) ?? null);
              }}
            />
          )}
        </div>
      </Modal>
    </div>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Review />
    </Suspense>
  );
}
