"use client";
import { ArrowLeft, Calculator, Check, Loader2, Plus, Ruler, Sparkles, SlidersHorizontal, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatMoney } from "@/modules/boq/calculator";
import type { roomOptions } from "@/modules/generation/options";
import { api } from "./api";
import { useLightbox, ZoomBadge } from "./lightbox";
import { Button, cx, ErrorNote, inputCls, Modal, Pill, Spinner } from "./ui";

type Options = Awaited<ReturnType<typeof roomOptions>>;
type Card = {
  key: string;
  kind: "library" | "ai";
  img: string;
  full: string;
  title: string;
  sub: string;
  tierOfferingId?: string | null;
  tierName?: string | null;
  referenceId?: string;
  generatedAssetId?: string;
  previewId?: string | null;
  isDemo?: boolean;
};

const PAGE = 6;

/**
 * The interactive popup for one room: 1 Original baseline reference, categorized AI designs
 * (Economy, Premium Economy, ...), and an itemized BOQ estimate backed by room geometry.
 */
export function RoomOptionsModal({ sessionId, roomId, onClose, onChosen }: { sessionId: string; roomId: string | null; onClose: () => void; onChosen: () => void }) {
  const [data, setData] = useState<Options | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<string>("all");
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<Card | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmAi, setConfirmAi] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [starting, setStarting] = useState(false);
  const [autoGenerating, setAutoGenerating] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [showBoq, setShowBoq] = useState(true);
  const activeRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const { openLightbox, lightboxNode } = useLightbox();

  const load = useCallback(() => {
    if (!roomId) return Promise.resolve();
    return api<Options>(`/api/sessions/${sessionId}/rooms/${roomId}/options`)
      .then((d) => {
        setData(d);
        setSelectedModelId((cur) => cur || d.ai.defaultModelId);
        setSelectedTierId((cur) => cur || d.selection?.offeringId || d.tiers[0]?.offering.id || null);
        setErr(null);
      })
      .catch((e) => setErr(e.message));
  }, [sessionId, roomId]);
  useEffect(() => {
    load();
  }, [load]);

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

  const tierCards: Card[] = (data?.tiers ?? []).flatMap((t) =>
    t.images.map((img) => ({
      key: img.generatedAssetId ?? img.previewId ?? img.id,
      kind: "ai" as const,
      img: img.url,
      full: img.url,
      title: `${t.offering.name} AI concept`,
      sub: img.basedOn ? `Based on ${img.basedOn}` : t.offering.description,
      tierOfferingId: t.offering.id,
      tierName: t.offering.name,
      generatedAssetId: img.generatedAssetId ?? undefined,
      previewId: img.previewId,
    })),
  );
  const seenGenIds = new Set(tierCards.map((c) => c.key));
  const untaggedGen: Card[] = (data?.generated ?? [])
    .filter((g) => !seenGenIds.has(g.id))
    .map((g) => ({
      key: g.id,
      kind: "ai" as const,
      img: g.url,
      full: g.url,
      title: g.tierName ? `${g.tierName} AI concept` : "New AI design",
      sub: g.basedOn ? `Based on ${g.basedOn}` : "",
      tierOfferingId: g.tierOfferingId,
      tierName: g.tierName,
      generatedAssetId: g.id,
    }));
  const libraryCards: Card[] = (data?.library ?? []).map((r) => ({
    key: r.id,
    kind: "library" as const,
    img: r.thumbUrl,
    full: r.imageUrl,
    title: `Original · ${r.project.name}`,
    sub: [r.project.propertyName, r.materials.slice(0, 2).join(", ")].filter(Boolean).join(" · "),
    referenceId: r.id,
    isDemo: r.isDemo,
  }));

  const allCards = [...tierCards, ...untaggedGen, ...libraryCards];
  const filteredCards =
    filterTab === "all"
      ? allCards
      : filterTab === "original"
        ? libraryCards
        : allCards.filter((c) => c.tierOfferingId === filterTab);

  const visible = filteredCards.slice(0, shown);
  const chosenKey = data?.selection ? (data.selection.generatedAssetId ?? data.selection.referenceId) : null;
  const pending = data?.activeJobs.length ?? 0;
  const configuredModels = data?.ai.models.filter((m) => m.configured) ?? [];
  const activeModel = configuredModels.find((m) => m.id === selectedModelId) ?? configuredModels[0] ?? data?.ai.models.find((m) => m.id === selectedModelId);
  const activeTier = (data?.tiers ?? []).find((t) => t.offering.id === (selectedTierId ?? filterTab)) ?? data?.tiers[0] ?? null;

  async function choose(c: Card) {
    setSaving(true);
    setErr(null);
    try {
      await api(`/api/sessions/${sessionId}/selections`, {
        method: "POST",
        json: {
          roomId,
          referenceId: c.referenceId,
          generatedAssetId: c.generatedAssetId,
          previewId: c.previewId,
          tierOfferingId: c.tierOfferingId,
        },
      });
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

  async function generateTierPack() {
    setAutoGenerating(true);
    setErr(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await api(`/api/sessions/${sessionId}/rooms/${roomId}/auto-preview`, {
        method: "POST",
        json: { modelId: activeModel?.id },
        signal: ac.signal,
      });
      await load();
      onChosen();
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr((e as Error).message);
    } finally {
      abortRef.current = null;
      setAutoGenerating(false);
    }
  }

  async function stopGenerating() {
    setStopping(true);
    abortRef.current?.abort();
    abortRef.current = null;
    setAutoGenerating(false);
    setStarting(false);
    try {
      await api(`/api/sessions/${sessionId}/previews`, { method: "DELETE" });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setStopping(false);
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
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const tierTarget = filterTab !== "all" && filterTab !== "original" ? filterTab : selectedTierId;
      await api(`/api/sessions/${sessionId}/rooms/${roomId}/options`, {
        method: "POST",
        json: { confirmed: true, count: 2, modelId: activeModel?.id, tierOfferingId: tierTarget },
        signal: ac.signal,
      });
      setConfirmAi(false);
      setShown((n) => Math.max(n, PAGE));
      await load();
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr((e as Error).message);
    } finally {
      abortRef.current = null;
      setStarting(false);
    }
  }

  return (
    <Modal open={Boolean(roomId)} onClose={onClose} wide title="Design options & BOQ">
      <div className="space-y-5 p-6">
        {!data && !err && <Spinner label="Loading design options" />}
        {data && (
          <div className="flex flex-wrap items-start justify-between gap-4 pr-8">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-stone-600">
                {data.roomTypeName} · {data.metrics.floorAreaSqft} sq ft ({data.metrics.floorAreaSqm} m²)
                {data.metrics.seatCount > 0 ? ` · ${data.metrics.seatCount} seats` : ""}
              </p>
              <h2 className="font-display text-3xl">{data.room.name}</h2>
              <p className="text-sm text-stone-600">Compare the Original reference with Economy &amp; Premium Economy AI concepts and real-time BOQ.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {data.tiers.map((t) => {
                const selected = (activeTier?.offering.id ?? null) === t.offering.id;
                return (
                  <button
                    key={t.offering.id}
                    onClick={() => {
                      setSelectedTierId(t.offering.id);
                      setFilterTab(t.offering.id);
                    }}
                    className={cx(
                      "rounded-2xl px-3 py-2 text-left ring-1 transition",
                      selected ? "bg-ink text-paper ring-ink" : "bg-stone-50 text-ink ring-stone-200 hover:bg-white",
                    )}
                  >
                    <p className={cx("text-[11px] font-medium uppercase tracking-wide", selected ? "text-stone-300" : "text-stone-500")}>
                      {t.offering.name}
                    </p>
                    <p className="text-sm font-semibold">{formatMoney(t.boq.totalAmount, data.currency)}</p>
                    <p className={cx("text-[10px]", selected ? "text-stone-300" : "text-stone-500")}>
                      {formatMoney(t.boq.costPerSqft, data.currency)} / sq ft · {t.images.length} preview{t.images.length === 1 ? "" : "s"}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <ErrorNote error={err} />

        {open ? (
          <div className="space-y-3 fade-in">
            <button onClick={() => setOpen(null)} className="inline-flex items-center gap-1 text-sm text-stone-600 hover:text-ink">
              <ArrowLeft className="size-4" /> All options
            </button>
            <button
              type="button"
              onClick={() => openLightbox({ src: open.full, title: open.title, subtitle: open.sub })}
              className="group relative block w-full cursor-zoom-in overflow-hidden rounded-2xl bg-ink"
              aria-label="Enlarge full screen"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={open.full} alt={open.title} className="mx-auto max-h-[60vh] object-contain" />
              <ZoomBadge className="right-3 top-3" />
            </button>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">
                  {open.title} {open.tierName && <Pill tone="good">{open.tierName}</Pill>}{" "}
                  {open.kind === "ai" && <Pill tone="warn">AI concept, not to exact dimensions</Pill>} {open.isDemo && <Pill tone="demo">DEMO</Pill>}
                </p>
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
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-3">
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: "all", label: `All (${allCards.length})` },
                    { id: "original", label: `Original (${libraryCards.length})` },
                    ...data.tiers.map((t) => ({ id: t.offering.id, label: `${t.offering.name} (${t.images.length})` })),
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => {
                        setFilterTab(tab.id);
                        if (tab.id !== "all" && tab.id !== "original") setSelectedTierId(tab.id);
                      }}
                      className={cx(
                        "rounded-full px-3 py-1 text-xs font-medium transition",
                        filterTab === tab.id ? "bg-bronze text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200",
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                {data.tiers.some((t) => t.images.length === 0) && data.ai.available && (
                  <Button size="sm" variant="secondary" onClick={generateTierPack} loading={autoGenerating}>
                    <Sparkles className="size-3.5" /> Auto-generate missing tier previews
                  </Button>
                )}
              </div>

              {filteredCards.length === 0 && pending === 0 && (
                <div className="rounded-2xl bg-stone-50 p-6 text-center text-sm text-stone-600">
                  No designs in this category yet.{" "}
                  {data.ai.available ? "Click “Auto-generate missing tier previews” or generate custom variations below." : "Approve pictures in Studio first."}
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: pending }).map((_, i) => (
                  <div key={`p${i}`} className="flex h-56 flex-col items-center justify-center gap-2 rounded-2xl bg-stone-50 text-sm text-stone-600 ring-1 ring-stone-100">
                    <Loader2 className="size-6 animate-spin text-bronze" /> Creating AI design…
                  </div>
                ))}
                {visible.map((c) => (
                  <div key={c.key} className={cx("group overflow-hidden rounded-2xl bg-white ring-1 transition hover:shadow-md", chosenKey === c.key ? "ring-2 ring-bronze" : "ring-stone-100")}>
                    <button onClick={() => setOpen(c)} className="relative block w-full text-left">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.img} alt={c.title} className="block h-48 w-full object-cover transition duration-500 group-hover:scale-[1.02]" />
                      {chosenKey === c.key && (
                        <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-bronze px-2 py-1 text-xs text-white">
                          <Check className="size-3" /> Chosen{saved === c.key ? " · saved" : ""}
                        </span>
                      )}
                      {c.tierName ? (
                        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-[11px] font-medium shadow-sm">
                          <Sparkles className="size-3 text-bronze" /> {c.tierName}
                        </span>
                      ) : (
                        <span className="absolute right-3 top-3 rounded-full bg-ink/80 px-2 py-1 text-[11px] text-white">Original</span>
                      )}
                      {c.isDemo && <span className="absolute bottom-3 left-3"><Pill tone="demo">DEMO</Pill></span>}
                    </button>
                    <div className="flex items-center justify-between gap-2 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.title}</p>
                        <p className="truncate text-xs text-stone-600">{c.sub || " "}</p>
                      </div>
                      <Button size="sm" variant={chosenKey === c.key ? "secondary" : "primary"} onClick={() => choose(c)} loading={saving}>
                        {chosenKey === c.key ? "Chosen" : "Choose"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {activeTier && (
                <div className="rounded-2xl bg-stone-50 p-4 ring-1 ring-stone-100">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Calculator className="size-4 text-bronze" />
                      <h3 className="font-display text-lg">
                        Itemized BOQ · {activeTier.offering.name} ({formatMoney(activeTier.boq.totalAmount, data.currency)})
                      </h3>
                      <Pill>{formatMoney(activeTier.boq.costPerSqft, data.currency)} / sq ft</Pill>
                    </div>
                    <button onClick={() => setShowBoq((v) => !v)} className="text-xs font-medium text-bronze hover:underline">
                      {showBoq ? "Hide lines" : "Show lines"}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-stone-600">
                    Computed from {data.metrics.floorAreaSqft} sq ft floor area, {data.metrics.wallAreaSqft} sq ft wall area, and {data.metrics.seatCount} seats ({data.metrics.seatSource}).{" "}
                    <Link href={`/atlas/${sessionId}/rooms/${roomId}/space`} className="underline">Adjust exact room measurements</Link>.
                  </p>
                  {showBoq && (
                    <div className="mt-3 overflow-x-auto rounded-xl bg-white ring-1 ring-stone-100">
                      <table className="w-full text-xs">
                        <thead className="bg-stone-50 text-left text-stone-600">
                          <tr>
                            <th className="px-3 py-2 font-medium">Category</th>
                            <th className="px-3 py-2 font-medium">Item &amp; Specification</th>
                            <th className="px-3 py-2 text-right font-medium">Qty</th>
                            <th className="px-3 py-2 text-right font-medium">Rate</th>
                            <th className="px-3 py-2 text-right font-medium">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeTier.boq.lines.map((l) => (
                            <tr key={l.itemId} className="border-t border-stone-100">
                              <td className="px-3 py-2 whitespace-nowrap text-stone-600">{l.categoryLabel}</td>
                              <td className="px-3 py-2">
                                <p className="font-medium text-ink">{l.name}</p>
                                <p className="text-[11px] text-stone-500">{l.specification}</p>
                              </td>
                              <td className="px-3 py-2 text-right whitespace-nowrap">{l.quantity} {l.unit}</td>
                              <td className="px-3 py-2 text-right whitespace-nowrap">{formatMoney(l.unitRate, data.currency)}</td>
                              <td className="px-3 py-2 text-right font-medium whitespace-nowrap">{formatMoney(l.amount, data.currency)}</td>
                            </tr>
                          ))}
                          <tr className="border-t border-stone-200 bg-stone-50 font-semibold">
                            <td colSpan={4} className="px-3 py-2 text-right">Room Total ({activeTier.offering.name})</td>
                            <td className="px-3 py-2 text-right">{formatMoney(activeTier.boq.totalAmount, data.currency)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-4">
                {filteredCards.length > shown && (
                  <Button variant="secondary" onClick={() => setShown((n) => n + PAGE)}>
                    <Plus className="size-4" /> Show {Math.min(PAGE, filteredCards.length - shown)} more
                  </Button>
                )}
                {!confirmAi ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={() => setConfirmAi(true)} disabled={!data.ai.available || pending > 0}>
                      <Sparkles className="size-4" /> {pending > 0 ? "Creating designs…" : `Generate 2 more${activeTier ? ` (${activeTier.offering.name})` : ""}`}
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
                    Uses {activeModel?.provider === "openai" ? "OpenAI" : "Higgsfield"} ({activeModel?.label ?? "AI"}) for 2 images. Go ahead?
                    <Button size="sm" onClick={createAi} loading={starting}>Yes, create</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmAi(false)}>Cancel</Button>
                  </div>
                )}
                {(autoGenerating || starting || pending > 0) && (
                  <Button variant="danger" size="sm" onClick={stopGenerating} loading={stopping}>
                    <Square className="size-3.5 fill-current" /> Stop generating AI
                  </Button>
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
      {lightboxNode}
    </Modal>
  );
}
