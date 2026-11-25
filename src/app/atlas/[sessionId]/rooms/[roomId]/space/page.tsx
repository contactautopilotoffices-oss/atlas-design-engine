"use client";
import { AlertCircle, ArrowLeft, Check, Info, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/components/api";
import { useConfig } from "@/components/references";
import type { ClassificationResult, RoomSpec, RoomSpecRecord, ValidationIssue } from "@/modules/core/schemas";
import type { SceneModel } from "@/modules/spatial/scene";
import { Button, cx, ErrorNote, Field, inputCls, Pill, Spinner, StageBadge } from "@/components/ui";

const Room3D = dynamic(() => import("@/components/room-3d"), { ssr: false, loading: () => <div className="flex h-full items-center justify-center"><Spinner label="Preparing 3D view" /></div> });

type Eval = { issues: ValidationIssue[]; classification: ClassificationResult; isValid: boolean; scene: SceneModel | null };
const uid = () => Math.random().toString(36).slice(2, 9);
const WALLS = ["north", "east", "south", "west"] as const;

function Num({ value, onChange, step = 0.1, min = 0 }: { value: number; onChange: (n: number) => void; step?: number; min?: number }) {
  return <input type="number" className={inputCls} value={Number.isFinite(value) ? value : ""} step={step} min={min} onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))} />;
}

export default function SpacePage() {
  const { sessionId, roomId } = useParams<{ sessionId: string; roomId: string }>();
  const { config } = useConfig();
  const [spec, setSpec] = useState<RoomSpec | null>(null);
  const [saved, setSaved] = useState<RoomSpecRecord | null>(null);
  const [ev, setEv] = useState<Eval | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCeiling, setShowCeiling] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api<{ record: RoomSpecRecord | null; defaults: RoomSpec | null }>(`/api/sessions/${sessionId}/rooms/${roomId}/spec`)
      .then((d) => {
        setSaved(d.record);
        setSpec(d.record?.spec ?? d.defaults);
      })
      .catch((e) => setErr(e.message));
  }, [sessionId, roomId]);

  // Live validation + scene rebuild whenever a measurement changes.
  useEffect(() => {
    if (!spec) return;
    const t = setTimeout(() => {
      api<Eval>("/api/spatial/evaluate", { method: "POST", json: spec })
        .then(setEv)
        .catch((e) => setEv({ issues: [{ level: "error", field: "form", message: e.message }], classification: { suggestedRoomTypeId: null, confidence: "low", scores: [], contradictions: [] }, isValid: false, scene: null }));
    }, 250);
    return () => clearTimeout(t);
  }, [spec]);

  const rtName = useMemo(() => Object.fromEntries((config?.roomTypes ?? []).map((r) => [r.id, r.name])), [config]);
  if (err) return <div className="mx-auto max-w-3xl p-10"><ErrorNote error={err} /></div>;
  if (!spec || !config) return <div className="p-10"><Spinner /></div>;

  const up = (patch: Record<string, unknown>) => {
    setSpec({ ...spec, ...(patch as Partial<RoomSpec>) });
    setDirty(true);
  };
  const u = spec.unit;

  async function save() {
    setSaving(true);
    try {
      const { record } = await api<{ record: RoomSpecRecord }>(`/api/sessions/${sessionId}/rooms/${roomId}/spec`, { method: "PUT", json: spec });
      setSaved(record);
      setDirty(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const issueTone = (l: ValidationIssue["level"]) => (l === "error" ? "bg-danger-soft text-danger" : l === "warning" ? "bg-planned-soft text-planned" : "bg-stone-100 text-ink-soft");
  const openingEditor = (key: "doors" | "windows", label: string) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{label}</p>
        <Button size="sm" variant="ghost" onClick={() => up({ [key]: [...spec[key], { id: uid(), wall: "south", offset: 0.5, width: key === "doors" ? 1 : 1.5, height: key === "doors" ? 2.1 : 1.4, sillHeight: key === "doors" ? 0 : 0.9 }] })}>
          <Plus className="size-3.5" /> Add
        </Button>
      </div>
      {spec[key].map((o, i) => (
        <div key={o.id} className="grid grid-cols-[1fr_repeat(4,minmax(0,1fr))_auto] items-end gap-1.5">
          <Field label="Wall">
            <select className={inputCls} value={o.wall} onChange={(e) => up({ [key]: spec[key].map((x, j) => (j === i ? { ...x, wall: e.target.value as (typeof WALLS)[number] } : x)) })}>
              {WALLS.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </Field>
          <Field label={`From corner (${u})`}><Num value={o.offset} onChange={(n) => up({ [key]: spec[key].map((x, j) => (j === i ? { ...x, offset: n } : x)) })} /></Field>
          <Field label={`Width (${u})`}><Num value={o.width} onChange={(n) => up({ [key]: spec[key].map((x, j) => (j === i ? { ...x, width: n } : x)) })} /></Field>
          <Field label={`Height (${u})`}><Num value={o.height} onChange={(n) => up({ [key]: spec[key].map((x, j) => (j === i ? { ...x, height: n } : x)) })} /></Field>
          <Field label={`Sill (${u})`}><Num value={o.sillHeight} onChange={(n) => up({ [key]: spec[key].map((x, j) => (j === i ? { ...x, sillHeight: n } : x)) })} /></Field>
          <button className="mb-2 p-1 text-stone-400 hover:text-danger" aria-label="Remove" onClick={() => up({ [key]: spec[key].filter((_, j) => j !== i) })}><Trash2 className="size-4" /></button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/atlas/${sessionId}?room=${roomId}`} className="mb-1 inline-flex items-center gap-1 text-sm text-stone-600 hover:text-ink"><ArrowLeft className="size-4" /> Back to floor plan</Link>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl">Measured room</h1>
            <StageBadge state="live" />
          </div>
          <p className="text-sm text-stone-600">Enter the real measurements. The 3D model is drawn only from these numbers.</p>
        </div>
        <div className="flex items-center gap-2">
          {saved && !dirty && <Pill tone={saved.isValid ? "good" : "bad"}>{saved.isValid ? "Saved and valid" : "Saved with errors"}</Pill>}
          {dirty && <Pill tone="warn">Unsaved changes</Pill>}
          <Button onClick={save} loading={saving}><Save className="size-4" /> Save measurements</Button>
          <Link href={`/atlas/${sessionId}/rooms/${roomId}/visualise`}><Button variant="secondary" disabled={!saved?.isValid || dirty}><Sparkles className="size-4" /> Continue to AI visualisation</Button></Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-5 rounded-3xl bg-white p-5 ring-1 ring-stone-100">
          <div className="grid grid-cols-4 gap-2">
            <Field label="Units">
              <select className={inputCls} value={u} onChange={(e) => up({ unit: e.target.value as "m" | "ft" })}>
                <option value="m">metres</option>
                <option value="ft">feet</option>
              </select>
            </Field>
            <Field label={`Length (${u})`}><Num value={spec.length} onChange={(n) => up({ length: n })} /></Field>
            <Field label={`Width (${u})`}><Num value={spec.width} onChange={(n) => up({ width: n })} /></Field>
            <Field label={`Height (${u})`}><Num value={spec.height} onChange={(n) => up({ height: n })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Room type">
              <select className={inputCls} value={spec.roomTypeId ?? ""} onChange={(e) => up({ roomTypeId: e.target.value || null })}>
                <option value="">Not sure</option>
                {config.roomTypes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Occupancy"><Num value={spec.occupancy} step={1} onChange={(n) => up({ occupancy: Math.round(n) })} /></Field>
            <Field label="Table arrangement">
              <input className={inputCls} list="arrangements" value={spec.tableArrangement} onChange={(e) => up({ tableArrangement: e.target.value })} />
              <datalist id="arrangements">{["rectangular", "round", "boardroom", "u-shape", "desk", "lounge", "none"].map((a) => <option key={a} value={a} />)}</datalist>
            </Field>
            <Field label={`Circulation (${u})`} hint="Clear walkway width"><Num value={spec.circulationClearance} onChange={(n) => up({ circulationClearance: n })} /></Field>
          </div>
          <Field label="Intended use"><input className={inputCls} value={spec.intendedUse} placeholder="e.g. client meetings and video calls" onChange={(e) => up({ intendedUse: e.target.value })} /></Field>
          {openingEditor("doors", "Doors")}
          {openingEditor("windows", "Windows")}
          {(["columns", "obstructions"] as const).map((key) => (
            <div key={key} className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{key === "columns" ? "Columns / fixed structure" : "Existing obstructions"}</p>
                <Button size="sm" variant="ghost" onClick={() => up({ [key]: [...spec[key], { id: uid(), label: "", x: 0.5, y: 0.5, w: 0.45, d: 0.45, h: null }] })}><Plus className="size-3.5" /> Add</Button>
              </div>
              {spec[key].map((b, i) => (
                <div key={b.id} className="grid grid-cols-[1.4fr_repeat(4,minmax(0,1fr))_auto] items-end gap-1.5">
                  <Field label="Label"><input className={inputCls} value={b.label} onChange={(e) => up({ [key]: spec[key].map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} /></Field>
                  {(["x", "y", "w", "d"] as const).map((f) => (
                    <Field key={f} label={`${{ x: "From west", y: "From north", w: "Width", d: "Depth" }[f]} (${u})`}><Num value={b[f]} onChange={(n) => up({ [key]: spec[key].map((x, j) => (j === i ? { ...x, [f]: n } : x)) })} /></Field>
                  ))}
                  <button className="mb-2 p-1 text-stone-400 hover:text-danger" aria-label="Remove" onClick={() => up({ [key]: spec[key].filter((_, j) => j !== i) })}><Trash2 className="size-4" /></button>
                </div>
              ))}
            </div>
          ))}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Required furniture</p>
              <Button size="sm" variant="ghost" onClick={() => up({ furniture: [...spec.furniture, { id: uid(), type: "Meeting chair", count: 4, w: 0.6, d: 0.6, h: 0.9 }] })}><Plus className="size-3.5" /> Add</Button>
            </div>
            {spec.furniture.map((f, i) => (
              <div key={f.id} className="grid grid-cols-[1.6fr_repeat(4,minmax(0,1fr))_auto] items-end gap-1.5">
                <Field label="Item"><input className={inputCls} value={f.type} onChange={(e) => up({ furniture: spec.furniture.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)) })} /></Field>
                <Field label="Count"><Num value={f.count} step={1} onChange={(n) => up({ furniture: spec.furniture.map((x, j) => (j === i ? { ...x, count: Math.round(n) } : x)) })} /></Field>
                {(["w", "d", "h"] as const).map((k) => (
                  <Field key={k} label={`${{ w: "W", d: "D", h: "H" }[k]} (${u})`}><Num value={f[k]} onChange={(n) => up({ furniture: spec.furniture.map((x, j) => (j === i ? { ...x, [k]: n } : x)) })} /></Field>
                ))}
                <button className="mb-2 p-1 text-stone-400 hover:text-danger" aria-label="Remove" onClick={() => up({ furniture: spec.furniture.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></button>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="relative h-[460px] overflow-hidden rounded-3xl bg-paper ring-1 ring-stone-100">
            {ev?.scene ? <Room3D scene={ev.scene} unit={u} showCeiling={showCeiling} /> : <div className="flex h-full items-center justify-center text-sm text-stone-600">Enter valid length, width and height to draw the room.</div>}
            <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full bg-white/90 px-2 py-0.5">Drag to orbit · scroll to zoom</span>
              <label className="flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5"><input type="checkbox" checked={showCeiling} onChange={(e) => setShowCeiling(e.target.checked)} /> Ceiling</label>
              <span className="rounded-full bg-white/90 px-2 py-0.5">Blue-grey boxes = placeholder furniture at exact size</span>
            </div>
          </div>
          {ev?.scene?.furnitureUnplaced.length ? <p className="text-xs text-planned">Could not fit in the drawing: {ev.scene.furnitureUnplaced.join(", ")}.</p> : null}
          <div className="rounded-3xl bg-white p-5 ring-1 ring-stone-100">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium">{ev?.isValid ? <Check className="size-4 text-live" /> : <AlertCircle className="size-4 text-danger" />} Checks</p>
            {ev && ev.issues.length === 0 && <p className="text-sm text-live">No problems found.</p>}
            <ul className="space-y-1.5">
              {ev?.issues.map((i, n) => (
                <li key={n} className={cx("rounded-lg px-3 py-1.5 text-xs", issueTone(i.level))}>
                  <span className="font-semibold uppercase">{i.level === "review" ? "needs review" : i.level}</span> · {i.message}
                </li>
              ))}
            </ul>
            {ev && (
              <div className="mt-4 border-t border-stone-100 pt-3">
                <p className="mb-1 flex items-center gap-1 text-sm font-medium"><Info className="size-3.5" /> Room type check</p>
                <p className="text-xs text-stone-600">
                  Signals point to <b>{rtName[ev.classification.suggestedRoomTypeId ?? ""] ?? "no clear type"}</b> ({ev.classification.confidence} confidence). This weighs your choice, purpose, seating, table arrangement and area per person; there is no single size cut-off.
                </p>
                <ul className="mt-2 space-y-1 text-[11px] text-stone-600">
                  {ev.classification.scores.slice(0, 3).map((s) => (
                    <li key={s.roomTypeId}><b>{rtName[s.roomTypeId]}</b> {s.score}: {s.reasons.join("; ") || "no matching signals"}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
