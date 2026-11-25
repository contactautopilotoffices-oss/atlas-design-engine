"use client";
import { ArrowLeft, Check, Loader2, Plus, Ruler, Sparkles, SlidersHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { roomOptions } from "@/modules/generation/options";
import { api } from "./api";
import { Button, cx, ErrorNote, inputCls, Modal, Pill, Spinner } from "./ui";

type Options = Awaited<ReturnType<typeof roomOptions>>;
type Card = { key: string; kind: "library" | "ai"; img: string; full: string; title: string; sub: string; referenceId?: string; generatedAssetId?: string; isDemo?: boolean };

const PAGE = 4;

/**
 * The client popup for one room: design options from our past projects (4 at a time),
 * plus new AI designs created on request. Choosing an option saves it straight away.
 */
export function RoomOptionsModal({ sessionId, roomId, onClose, onChosen }: { sessionId: string; roomId: string | null; onClose: () => void; onChosen: () => void }) {
  const [data, setData] = useState<Options | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<Card | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmAi, setConfirmAi] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const activeRef = useRef(0);

  const load = useCallback(() => {
    if (!roomId) return Promise.resolve();
    return api<Options>(`/api/sessions/${sessionId}/rooms/${roomId}/options`)
      .then((d) => {
        setData(d);
        setSelectedModelId((cur) => cur || d.ai.defaultModelId);
        setErr(null);
      })
      .catch((e) => setErr(e.message));
  }, [sessionId, roomId]);
  useEffect(() => {
    load();
  }, [load]);

  // While AI designs are being made, nudge the server to check on them, then refresh the popup.
  useEffect(() => {
    const jobs = data?.activeJobs ?? [];
    activeRef.current = jobs.length;
    if (!jobs.length) return;
    const t = setInterval(async () => {
      await Promise.all(jobs.map((j) => api(`/api/generation/jobs/${j.id}`).catch(() => undefined)));
      load();
    }, 3000);
    return () => clearInterval(t);
  }, [data?.activeJobs, load]);

  if (!roomId) return null;

  const cards: Card[] = [
    ...(data?.generated ?? []).map((g) => ({ key: g.id, kind: "ai" as const, img: g.url, full: g.url, title: "New AI design", sub: g.basedOn ? `Based on ${g.basedOn}` : "", generatedAssetId: g.id })),
    ...(data?.library ?? []).map((r) => ({ key: r.id, kind: "library" as const, img: r.thumbUrl, full: r.imageUrl, title: `From ${r.project.name}`, sub: [r.project.propertyName, r.materials.slice(0, 2).join(", ")].filter(Boolean).join(" · "), referenceId: r.id, isDemo: r.isDemo })),
  ];
  const visible = cards.slice(0, shown);
  const chosenKey = data?.selection ? (data.selection.generatedAssetId ?? data.selection.referenceId) : null;
  const pending = data?.activeJobs.length ?? 0;
  const configuredModels = data?.ai.models.filter((m) => m.configured) ?? [];
  const activeModel = configuredModels.find((m) => m.id === selectedModelId) ?? configuredModels[0] ?? data?.ai.models.find((m) => m.id === selectedModelId);

  async function choose(c: Card) {
    setSaving(true);
    try {
      await api(`/api/sessions/${sessionId}/selections`, { method: "POST", json: { roomId, referenceId: c.referenceId, generatedAssetId: c.generatedAssetId } });
      setSaved(c.key);
      setOpen(null);
      await load();
      onChosen();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function removeAi(assetId: string) {
    if (!confirm("Delete this AI design?")) return;
    setDeleting(true);
    setErr(null);
    try {
      await api(`/api/generated-assets/${assetId}`, { method: "DELETE" });
      setOpen(null);
      await load();
      onChosen();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  async function createAi() {
    setStarting(true);
    setErr(null);
    try {
      await api(`/api/sessions/${sessionId}/rooms/${roomId}/options`, { method: "POST", json: { confirmed: true, count: 4, modelId: activeModel?.id } });
      setConfirmAi(false);
      setShown((n) => Math.max(n, PAGE));
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <Modal open={Boolean(roomId)} onClose={onClose} wide title="Design options">
      <div className="space-y-5 p-6">
        {!data && !err && <Spinner label="Loading design options" />}
        {data && (
          <div className="pr-8">
            <p className="text-xs uppercase tracking-[0.18em] text-stone-600">{data.roomTypeName}{data.room.dimensions ? ` · ${data.room.dimensions.length} x ${data.room.dimensions.width} m` : ""}</p>
            <h2 className="font-display text-3xl">{data.room.name}</h2>
            <p className="text-sm text-stone-600">Pick the design you like. It is saved as soon as you choose it.</p>
          </div>
        )}
        <ErrorNote error={err} />

        {open ? (
          <div className="space-y-3 fade-in">
            <button onClick={() => setOpen(null)} className="inline-flex items-center gap-1 text-sm text-stone-600 hover:text-ink"><ArrowLeft className="size-4" /> All options</button>
            <div className="overflow-hidden rounded-2xl bg-ink">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={open.full} alt={open.title} className="mx-auto max-h-[62vh] object-contain" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{open.title} {open.kind === "ai" && <Pill tone="warn">AI concept, not to exact dimensions</Pill>} {open.isDemo && <Pill tone="demo">DEMO</Pill>}</p>
                <p className="text-xs text-stone-600">{open.sub}</p>
              </div>
              <div className="flex items-center gap-2">
                {open.kind === "ai" && open.generatedAssetId && (
                  <Button variant="ghost" onClick={() => removeAi(open.generatedAssetId!)} loading={deleting}>
                    <Trash2 className="size-4" /> Delete
                  </Button>
                )}
                <Button size="lg" onClick={() => choose(open)} loading={saving}>
                  <Check className="size-4" /> {chosenKey === open.key ? "This is your choice" : "Choose this design"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          data && (
            <>
              {cards.length === 0 && pending === 0 && (
                <div className="rounded-2xl bg-stone-50 p-6 text-center text-sm text-stone-600">No designs for this room type yet. {data.ai.available ? "Create some with AI below." : "Your team can approve pictures for it in Studio."}</div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                {Array.from({ length: pending }).map((_, i) => (
                  <div key={`p${i}`} className="flex h-64 flex-col items-center justify-center gap-2 rounded-2xl bg-stone-50 text-sm text-stone-600 ring-1 ring-stone-100">
                    <Loader2 className="size-6 animate-spin text-bronze" /> Creating a new design… usually under a minute
                  </div>
                ))}
                {visible.map((c) => (
                  <button key={c.key} onClick={() => setOpen(c)} className={cx("group overflow-hidden rounded-2xl bg-white text-left ring-1 transition hover:shadow-md", chosenKey === c.key ? "ring-2 ring-bronze" : "ring-stone-100")}>
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.img} alt={c.title} className="block h-64 w-full object-cover transition duration-500 group-hover:scale-[1.02]" />
                      {chosenKey === c.key && <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-bronze px-2 py-1 text-xs text-white"><Check className="size-3" /> Your choice{saved === c.key ? " · saved" : ""}</span>}
                      {c.kind === "ai" && <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-xs"><Sparkles className="size-3" /> AI design</span>}
                      {c.isDemo && <span className="absolute bottom-3 left-3"><Pill tone="demo">DEMO</Pill></span>}
                    </div>
                    <div className="p-3">
                      <p className="text-sm font-medium">{c.title}</p>
                      <p className="truncate text-xs text-stone-600">{c.sub || " "}</p>
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-4">
                {cards.length > shown && (
                  <Button variant="secondary" onClick={() => setShown((n) => n + PAGE)}><Plus className="size-4" /> Show {Math.min(PAGE, cards.length - shown)} more</Button>
                )}
                {!confirmAi ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={() => setConfirmAi(true)} disabled={!data.ai.available || pending > 0}>
                      <Sparkles className="size-4" /> {pending > 0 ? "Creating designs…" : "Create 4 new designs with AI"}
                    </Button>
                    {configuredModels.length > 1 && (
                      <select aria-label="AI model" className={cx(inputCls, "w-auto py-1.5 text-xs")} value={activeModel?.id ?? ""} onChange={(e) => setSelectedModelId(e.target.value)}>
                        {configuredModels.map((m) => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                      </select>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 rounded-full bg-planned-soft px-3 py-1.5 text-sm text-planned">
                    Uses {activeModel?.provider === "openai" ? "OpenAI" : "Higgsfield"} ({activeModel?.label ?? "AI"}) for 4 images. Go ahead?
                    <Button size="sm" onClick={createAi} loading={starting}>Yes, create</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmAi(false)}>Cancel</Button>
                  </div>
                )}
                {!data.ai.available && data.ai.reason && <span className="text-xs text-stone-600">{data.ai.reason}</span>}
                {data.failedRecently[0] && pending === 0 && <span className="text-xs text-danger">Last AI attempt failed: {data.failedRecently[0]}</span>}
                <span className="ml-auto flex gap-3 text-xs text-stone-600">
                  <Link href={`/atlas/${sessionId}/rooms/${roomId}/space`} className="inline-flex items-center gap-1 hover:text-ink"><Ruler className="size-3" /> Exact measurements</Link>
                  <Link href={`/atlas/${sessionId}/rooms/${roomId}/visualise`} className="inline-flex items-center gap-1 hover:text-ink"><SlidersHorizontal className="size-3" /> Advanced AI options</Link>
                </span>
              </div>
            </>
          )
        )}
      </div>
    </Modal>
  );
}
