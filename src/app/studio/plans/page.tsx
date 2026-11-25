"use client";
import { Check, CircleAlert, Eye, EyeOff, FileUp, MousePointerSquareDashed, Plus, Trash2, Upload } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { api } from "@/components/api";
import { useConfig } from "@/components/references";
import { Button, cx, Empty, ErrorNote, Field, inputCls, Pill, Spinner } from "@/components/ui";
import type { FloorPlan } from "@/modules/core/schemas";

type RoomType = { id: string; name: string };

type Pt = [number, number];
type PlanRow = FloorPlan & { propertyName: string };
type Reader = { configured: true; model: string } | { configured: false; reason: string };
type EditRoom = { id?: string; key: string; name: string; roomTypeId: string; polygon: Pt[]; confidence: "high" | "medium" | "low" | null };

const COLOURS = ["#8a6a45", "#2f7a5b", "#3d6fa8", "#b5552f", "#7b4fa0", "#a8873d", "#2f8a8a", "#a63d6b", "#5b6b2f", "#6e6556", "#3b3731", "#c07a2c", "#4f5fa0"];
const area = (p: Pt[]) => Math.abs(p.reduce((s, [x1, y1], i) => s + x1 * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y1, 0)) / 2;
const rect = (a: Pt, b: Pt): Pt[] => {
  const [x1, x2] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y1, y2] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
};
let keySeq = 0;
const toEdit = (plan: FloorPlan): EditRoom[] => plan.rooms.map((r) => ({ id: r.id, key: r.id, name: r.name, roomTypeId: r.roomTypeId, polygon: r.polygon, confidence: r.confidence }));

function UploadPanel({ onDone, reader }: { onDone: (plan: FloorPlan, notes: string[]) => void; reader: Reader | null }) {
  const { config } = useConfig();
  const [file, setFile] = useState<File | null>(null);
  const [propertyChoice, setProperty] = useState("");
  const [newName, setNewName] = useState("");
  const [city, setCity] = useState("");
  const [page, setPage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const properties = (config?.properties ?? []).filter((p) => !p.isDemo);
  const propertyId = propertyChoice || (properties.length ? properties[0].id : "new");
  const isDxf = file?.name.toLowerCase().endsWith(".dxf");
  const isPdf = file?.name.toLowerCase().endsWith(".pdf");
  const needsClaude = file && !isDxf;

  async function go() {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      if (propertyId === "new") {
        fd.set("newPropertyName", newName);
        fd.set("city", city);
      } else fd.set("propertyId", propertyId);
      if (isPdf && page.trim()) fd.set("page", page.trim());
      const r = await api<{ plan: FloorPlan; notes: string[] }>("/api/floor-plans", { method: "POST", body: fd });
      onDone(r.plan, r.notes);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-3xl bg-white p-5 ring-1 ring-stone-100">
      <div>
        <h2 className="font-display text-xl">Upload a floor plan</h2>
        <p className="text-sm text-stone-600">DXF gives exact sizes. PDF or a picture of the plan also works: Claude finds the rooms and you check them.</p>
      </div>
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-stone-200 px-4 py-8 text-center hover:border-bronze">
        <FileUp className="size-6 text-bronze" />
        <span className="text-sm font-medium">{file ? file.name : "Choose a DXF, PDF, PNG or JPG"}</span>
        <span className="text-xs text-stone-500">DWG? Open it in AutoCAD and use File, Save As, DXF.</span>
        <input type="file" className="hidden" accept=".dxf,.pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Property">
          <select className={inputCls} value={propertyId} onChange={(e) => setProperty(e.target.value)}>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            <option value="new">+ New property</option>
          </select>
        </Field>
        {isPdf && (
          <Field label="PDF page with the layout" hint="Leave empty and we pick the page that says LAYOUT or PLAN.">
            <input className={inputCls} inputMode="numeric" placeholder="Auto" value={page} onChange={(e) => setPage(e.target.value.replace(/\D/g, ""))} />
          </Field>
        )}
        {propertyId === "new" && (
          <>
            <Field label="New property name">
              <input className={inputCls} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Volt, Sky Mark Noida" />
            </Field>
            <Field label="City">
              <input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Noida" />
            </Field>
          </>
        )}
      </div>
      {needsClaude && reader && !reader.configured && <ErrorNote error={reader.reason} />}
      <ErrorNote error={err} />
      <Button onClick={go} loading={busy} disabled={!file || (propertyId === "new" && !newName.trim()) || Boolean(needsClaude && reader && !reader.configured)}>
        <Upload className="size-4" /> Find the rooms
      </Button>
      {busy && <p className="text-xs text-stone-500">{isDxf ? "Reading the drawing..." : "Claude is reading the plan. This usually takes 20 to 40 seconds."}</p>}
    </div>
  );
}

function Editor({ plan, roomTypes, onSaved, onDeleted, notes }: { plan: FloorPlan; roomTypes: RoomType[]; onSaved: (p: FloorPlan) => void; onDeleted: () => void; notes: string[] }) {
  const [name, setName] = useState(plan.name);
  const [rooms, setRooms] = useState<EditRoom[]>(() => toEdit(plan));
  const [selected, setSelected] = useState<string | null>(null);
  const [redraw, setRedraw] = useState(false);
  const [drag, setDrag] = useState<{ a: Pt; b: Pt } | null>(null);
  const [width, setWidth] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const colour = useMemo(() => Object.fromEntries(roomTypes.map((t, i) => [t.id, COLOURS[i % COLOURS.length]])), [roomTypes]);
  const typeName = useMemo(() => Object.fromEntries(roomTypes.map((t) => [t.id, t.name])), [roomTypes]);
  const scaleOk = plan.scale?.method === "drawing" || plan.scale?.method === "confirmed";
  const line = Math.max(plan.width, plan.height) / 450;
  const pad = Math.max(plan.width, plan.height) / 60;
  const checkCount = rooms.filter((r) => r.confidence === "low").length;

  const change = (fn: (r: EditRoom[]) => EditRoom[]) => {
    setRooms(fn);
    setDirty(true);
  };
  const toPlan = (e: ReactPointerEvent): Pt => {
    const s = svg.current!;
    const p = s.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(s.getScreenCTM()!.inverse());
    return [Math.max(0, Math.min(plan.width, q.x)), Math.max(0, Math.min(plan.height, q.y))];
  };
  const finishDrag = () => {
    if (!drag) return;
    const poly = rect(drag.a, drag.b);
    setDrag(null);
    if (area(poly) < (plan.width * plan.height) / 20000) return;
    if (redraw && selected) {
      change((rs) => rs.map((r) => (r.key === selected ? { ...r, polygon: poly, confidence: null } : r)));
      setRedraw(false);
    } else {
      const key = `new-${++keySeq}`;
      change((rs) => [...rs, { key, name: "New room", roomTypeId: "rt_other", polygon: poly, confidence: null }]);
      setSelected(key);
    }
  };

  async function save(extra: { realWidthMetres?: number; confirmScale?: boolean } = {}) {
    const r = await api<{ plan: FloorPlan }>(`/api/floor-plans/${plan.id}`, {
      method: "PATCH",
      json: { name, rooms: rooms.map(({ id, name, roomTypeId, polygon }) => ({ id, name, roomTypeId, polygon })), ...extra },
    });
    return r.plan;
  }
  async function run(label: string, fn: () => Promise<FloorPlan | void>) {
    setBusy(label);
    setErr(null);
    try {
      const p = await fn();
      if (p) onSaved(p);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const sel = rooms.find((r) => r.key === selected) ?? null;
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input className={cx(inputCls, "max-w-md font-medium")} value={name} onChange={(e) => (setName(e.target.value), setDirty(true))} />
          <Pill tone={plan.status !== "draft" ? "good" : "warn"}>{plan.status !== "draft" ? "Published: clients can open it" : "Draft: only staff can see it"}</Pill>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-stone-600">
          <MousePointerSquareDashed className="size-3.5" />
          {redraw ? <b className="text-bronze">Drag a box over the plan to redraw &quot;{sel?.name}&quot;.</b> : "Click a room to edit it. Drag on the plan to add a room that was missed."}
        </p>
        <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-stone-100">
          <svg
            ref={svg}
            viewBox={`${-pad} ${-pad} ${plan.width + pad * 2} ${plan.height + pad * 2}`}
            className="block h-auto w-full touch-none select-none"
            onPointerDown={(e) => {
              if ((e.target as Element).closest("[data-room]") && !redraw) return;
              (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
              const p = toPlan(e);
              setDrag({ a: p, b: p });
            }}
            onPointerMove={(e) => drag && setDrag({ ...drag, b: toPlan(e) })}
            onPointerUp={finishDrag}
          >
            {plan.background ? (
              <image href={`/api/assets/floor-plans/${plan.background.key}`} x={0} y={0} width={plan.width} height={plan.height} preserveAspectRatio="none" opacity={0.9} />
            ) : (
              <rect x={0} y={0} width={plan.width} height={plan.height} fill="#faf8f4" stroke="#1d1b18" strokeWidth={line} />
            )}
            {rooms.map((r, i) => {
              const c = colour[r.roomTypeId] ?? "#6e6556";
              const on = r.key === selected;
              const [x, y] = r.polygon[0];
              return (
                <g key={r.key} data-room onClick={() => (setSelected(r.key), setRedraw(false))} className="cursor-pointer">
                  <polygon
                    points={r.polygon.map((p) => p.join(",")).join(" ")}
                    fill={c}
                    fillOpacity={on ? 0.4 : 0.16}
                    stroke={r.confidence === "low" ? "#c07a2c" : c}
                    strokeDasharray={r.confidence === "low" ? `${line * 3} ${line * 2}` : undefined}
                    strokeWidth={on ? line * 3 : line * 1.6}
                  />
                  <rect x={x} y={y} width={line * 9} height={line * 6} fill={c} />
                  <text x={x + line * 4.5} y={y + line * 4.4} fontSize={line * 4.2} fill="#fff" textAnchor="middle" fontWeight={700}>
                    {i + 1}
                  </text>
                </g>
              );
            })}
            {drag && <polygon points={rect(drag.a, drag.b).map((p) => p.join(",")).join(" ")} fill="#8a6a45" fillOpacity={0.2} stroke="#8a6a45" strokeWidth={line * 2} strokeDasharray={`${line * 3} ${line * 2}`} />}
          </svg>
        </div>
        {notes.length > 0 && <p className="text-xs text-stone-500">{notes.join(" ")}</p>}
      </div>

      <div className="space-y-4">
        <div className={cx("space-y-2 rounded-2xl p-4 ring-1", scaleOk ? "bg-white ring-stone-100" : "bg-amber-50 ring-amber-200")}>
          <p className="text-sm font-medium">1. Check the size</p>
          <p className="text-sm">
            The whole plan is <b>{plan.width.toFixed(1)} m</b> wide and <b>{plan.height.toFixed(1)} m</b> tall.
          </p>
          {plan.scale?.note && <p className="text-xs text-stone-600">{plan.scale.method === "ai_estimate" ? `AI guess: ${plan.scale.note}` : plan.scale.note}</p>}
          {!scaleOk && (
            <Button size="sm" variant="secondary" loading={busy === "confirm"} onClick={() => run("confirm", () => save({ confirmScale: true }))}>
              <Check className="size-4" /> Looks right
            </Button>
          )}
          <div className="flex gap-2">
            <input className={inputCls} inputMode="decimal" placeholder="Real width in metres, e.g. 36.5" value={width} onChange={(e) => setWidth(e.target.value.replace(/[^\d.]/g, ""))} />
            <Button size="sm" variant="secondary" disabled={!Number(width)} loading={busy === "width"} onClick={() => run("width", () => save({ realWidthMetres: Number(width) }))}>
              Apply
            </Button>
          </div>
        </div>

        <div className="space-y-2 rounded-2xl bg-white p-4 ring-1 ring-stone-100">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">2. Check the rooms ({rooms.length})</p>
            {checkCount > 0 && <Pill tone="warn">{checkCount} to check</Pill>}
          </div>
          <ul className="max-h-[52vh] space-y-1.5 overflow-auto pr-1">
            {rooms.map((r, i) => (
              <li
                key={r.key}
                onClick={() => setSelected(r.key)}
                className={cx("rounded-xl p-2 ring-1", r.key === selected ? "bg-stone-50 ring-bronze" : "ring-stone-100", r.confidence === "low" && "bg-amber-50/60")}
              >
                <div className="flex items-center gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded text-xs font-bold text-white" style={{ background: colour[r.roomTypeId] ?? "#6e6556" }}>{i + 1}</span>
                  <input
                    className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-stone-200 focus:border-bronze focus:outline-none"
                    value={r.name}
                    onChange={(e) => change((rs) => rs.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))}
                  />
                  {r.confidence === "low" && <span title="Claude was not sure about this one"><CircleAlert className="size-4 text-amber-600" /></span>}
                  <button className="text-stone-400 hover:text-red-600" aria-label={`Remove ${r.name}`} onClick={(e) => (e.stopPropagation(), change((rs) => rs.filter((x) => x.key !== r.key)), setSelected(null))}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-2 pl-8">
                  <select
                    className="min-w-0 flex-1 rounded-md border border-stone-200 bg-white px-1.5 py-1 text-xs"
                    value={r.roomTypeId}
                    onChange={(e) => change((rs) => rs.map((x) => (x.key === r.key ? { ...x, roomTypeId: e.target.value } : x)))}
                  >
                    {roomTypes.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <span className="text-[11px] text-stone-500">{area(r.polygon).toFixed(0)} m²</span>
                  {r.key === selected && (
                    <button className="text-[11px] text-bronze underline" onClick={(e) => (e.stopPropagation(), setRedraw(true))}>
                      Redraw
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-stone-500">
            <Plus className="inline size-3" /> Missed a room? Drag a box over it on the plan.
            {sel ? ` Selected: ${sel.name} (${typeName[sel.roomTypeId] ?? ""}).` : ""}
          </p>
        </div>

        <div className="space-y-2 rounded-2xl bg-white p-4 ring-1 ring-stone-100">
          <p className="text-sm font-medium">3. Publish</p>
          <ErrorNote error={err} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!dirty} loading={busy === "save"} onClick={() => run("save", async () => { const p = await save(); setDirty(false); return p; })}>
              Save changes
            </Button>
            {plan.status === "draft" ? (
              <Button
                loading={busy === "publish"}
                disabled={!scaleOk}
                title={scaleOk ? undefined : "Check the size first"}
                onClick={() =>
                  run("publish", async () => {
                    if (dirty) await save();
                    return (await api<{ plan: FloorPlan }>(`/api/floor-plans/${plan.id}/publish`, { method: "POST", json: { publish: true } })).plan;
                  })
                }
              >
                <Eye className="size-4" /> Publish for clients
              </Button>
            ) : (
              <Button variant="ghost" loading={busy === "unpublish"} onClick={() => run("unpublish", async () => (await api<{ plan: FloorPlan }>(`/api/floor-plans/${plan.id}/publish`, { method: "POST", json: { publish: false } })).plan)}>
                <EyeOff className="size-4" /> Unpublish
              </Button>
            )}
            <Button
              variant="danger"
              size="sm"
              loading={busy === "delete"}
              onClick={() => confirm("Delete this floor plan?") && run("delete", async () => { await api(`/api/floor-plans/${plan.id}`, { method: "DELETE" }); onDeleted(); })}
            >
              Delete
            </Button>
          </div>
          {!scaleOk && <p className="text-xs text-amber-700">Check the size in step 1 before publishing.</p>}
        </div>
      </div>
    </div>
  );
}

function FloorPlansInner() {
  const params = useSearchParams();
  const { config } = useConfig();
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [reader, setReader] = useState<Reader | null>(null);
  const [openId, setOpenId] = useState<string | null>(params.get("planId"));
  const [notes, setNotes] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api<{ plans: PlanRow[]; reader: Reader }>("/api/floor-plans")
        .then((d) => (setPlans(d.plans), setReader(d.reader)))
        .catch((e) => setErr(e.message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  const open = plans?.find((p) => p.id === openId) ?? null;
  const roomTypes = config?.roomTypes ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Floor plans</h1>
        <p className="text-sm text-stone-600">Upload a plan, check the rooms it found, then publish it. Clients can only open published plans.</p>
      </div>
      <ErrorNote error={err} />
      {open ? (
        <div className="space-y-3">
          <button className="text-sm text-bronze underline" onClick={() => setOpenId(null)}>Back to all floor plans</button>
          <Editor
            key={`${open.id}:${open.updatedAt}`}
            plan={open}
            roomTypes={roomTypes}
            notes={notes}
            onSaved={(p) => setPlans((ps) => ps?.map((x) => (x.id === p.id ? { ...x, ...p } : x)) ?? null)}
            onDeleted={() => (setOpenId(null), load())}
          />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <UploadPanel
            reader={reader}
            onDone={(p, n) => {
              setNotes(n);
              load().then(() => setOpenId(p.id));
            }}
          />
          <div className="space-y-3">
            {!plans && <Spinner />}
            {plans?.length === 0 && <Empty title="No floor plans yet">Upload your first plan on the left.</Empty>}
            {plans?.map((p) => (
              <div key={p.id} className="flex w-full items-center gap-2 rounded-2xl bg-white p-3 ring-1 ring-stone-100 hover:ring-stone-200">
                <button disabled={p.isSample} onClick={() => (setNotes([]), setOpenId(p.id))} className="flex min-w-0 flex-1 items-center gap-4 text-left disabled:cursor-default">
                  <div className="grid h-16 w-24 shrink-0 place-items-center overflow-hidden rounded-lg bg-stone-50">
                    {p.background ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/assets/floor-plans/${p.background.key}`} alt="" className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-[10px] text-stone-400">{p.isSample ? "SAMPLE" : (p.source?.kind ?? "").toUpperCase()}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="text-xs text-stone-600">
                      {p.propertyName} · {p.rooms.length} rooms · {p.width.toFixed(0)} x {p.height.toFixed(0)} m
                    </p>
                  </div>
                  {p.isSample ? <Pill tone="demo">Sample</Pill> : <Pill tone={p.status !== "draft" ? "good" : "warn"}>{p.status !== "draft" ? "Published" : "Draft"}</Pill>}
                </button>
                {!p.isSample && (
                  <button
                    aria-label={`Delete ${p.name}`}
                    className="rounded-full p-2 text-stone-400 hover:bg-stone-100 hover:text-danger"
                    onClick={async () => {
                      if (!confirm(`Delete floor plan "${p.name}"?`)) return;
                      setErr(null);
                      try {
                        await api(`/api/floor-plans/${p.id}`, { method: "DELETE" });
                        load();
                      } catch (e) {
                        setErr((e as Error).message);
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function FloorPlansPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <FloorPlansInner />
    </Suspense>
  );
}
