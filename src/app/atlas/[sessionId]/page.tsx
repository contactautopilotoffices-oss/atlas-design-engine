"use client";
import { ArrowRight, Calculator, Check, LayoutGrid, Loader2, Play, Sparkles, Square, X } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/components/api";
import { FloorPlanView, type HoverAnchor, type RoomState } from "@/components/floor-plan";
import { useLightbox, ZoomBadge } from "@/components/lightbox";
import { useConfig } from "@/components/references";
import { RoomOptionsModal } from "@/components/room-options";
import { useSession } from "@/components/session";
import { Button, cx, ErrorNote, inputCls, Pill, Spinner } from "@/components/ui";
import { formatMoney } from "@/modules/boq/calculator";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-10"><Spinner label="Opening floor plan" /></div>}>
      <AtlasSession />
    </Suspense>
  );
}

function AtlasSession() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const search = useSearchParams();
  const { data, err, reload } = useSession(sessionId);
  const { config } = useConfig();
  const { openLightbox, lightboxNode } = useLightbox();
  const [roomId, setRoomId] = useState<string | null>(search.get("room"));
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<HoverAnchor>({ xPct: 50, yPct: 30 });
  const [generatingRooms, setGeneratingRooms] = useState<Record<string, boolean>>({});
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [aiPaused, setAiPaused] = useState(false);
  const [stoppingAi, setStoppingAi] = useState(false);
  const [quickSaving, setQuickSaving] = useState<string | null>(null);
  const [hoverErr, setHoverErr] = useState<string | null>(null);

  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoAttemptedRef = useRef<Set<string>>(new Set());
  const abortSetRef = useRef<Set<AbortController>>(new Set());

  const roomTypeNames = useMemo(() => Object.fromEntries((config?.roomTypes ?? []).map((r) => [r.id, r.name])), [config]);
  const roomStates = useMemo(() => Object.fromEntries((data?.rooms ?? []).map((r) => [r.room.id, (r.selection ? "submitted" : "empty") as RoomState])), [data]);

  const cancelLeave = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  };
  const scheduleLeave = () => {
    cancelLeave();
    leaveTimerRef.current = setTimeout(() => {
      setHoveredId(null);
      if (intentTimerRef.current) {
        clearTimeout(intentTimerRef.current);
        intentTimerRef.current = null;
      }
    }, 220);
  };

  const triggerAutoPreview = useCallback(
    async (targetRoomId: string) => {
      if (!data?.aiAvailable || aiPaused || autoAttemptedRef.current.has(targetRoomId)) return;
      const room = data.rooms.find((r) => r.room.id === targetRoomId);
      if (!room || !room.originalReference) return;
      const hasMissingTier = room.tierPreviews.some((t) => t.images.length === 0);
      if (!hasMissingTier) return;

      autoAttemptedRef.current.add(targetRoomId);
      setGeneratingRooms((cur) => ({ ...cur, [targetRoomId]: true }));
      setHoverErr(null);
      const ac = new AbortController();
      abortSetRef.current.add(ac);
      try {
        const res = await api<{ pendingJobIds?: string[] }>(`/api/sessions/${sessionId}/rooms/${targetRoomId}/auto-preview`, {
          method: "POST",
          json: {},
          signal: ac.signal,
        });
        await reload();
        if (res.pendingJobIds?.length && !ac.signal.aborted) {
          const poll = async () => {
            await Promise.all(res.pendingJobIds!.map((id) => api(`/api/generation/jobs/${id}`).catch(() => undefined)));
            await reload();
          };
          setTimeout(poll, 3500);
          setTimeout(poll, 9000);
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") setHoverErr((e as Error).message);
      } finally {
        abortSetRef.current.delete(ac);
        setGeneratingRooms((cur) => ({ ...cur, [targetRoomId]: false }));
      }
    },
    [data, aiPaused, sessionId, reload],
  );

  const handleHoverRoom = useCallback(
    (id: string | null, anchor?: HoverAnchor) => {
      if (!id) {
        scheduleLeave();
        return;
      }
      cancelLeave();
      setHoveredId(id);
      if (anchor) setHoverAnchor(anchor);
      if (intentTimerRef.current) clearTimeout(intentTimerRef.current);
      if (!aiPaused) {
        intentTimerRef.current = setTimeout(() => {
          triggerAutoPreview(id);
        }, 260);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [triggerAutoPreview, aiPaused],
  );

  async function stopAllAiGeneration() {
    setStoppingAi(true);
    setAiPaused(true);
    if (intentTimerRef.current) {
      clearTimeout(intentTimerRef.current);
      intentTimerRef.current = null;
    }
    for (const c of abortSetRef.current) c.abort();
    abortSetRef.current.clear();
    setGeneratingRooms({});
    setBatchGenerating(false);
    try {
      await api(`/api/sessions/${sessionId}/previews`, { method: "DELETE" });
      await reload();
    } catch (e) {
      setHoverErr((e as Error).message);
    } finally {
      setStoppingAi(false);
    }
  }

  useEffect(() => {
    return () => {
      cancelLeave();
      if (intentTimerRef.current) clearTimeout(intentTimerRef.current);
    };
  }, []);

  if (err) return <div className="mx-auto max-w-3xl p-10"><ErrorNote error={err} /></div>;
  if (!data || !config) return <div className="p-10"><Spinner label="Opening floor plan" /></div>;
  if (!data.floorPlan) return <div className="p-10"><ErrorNote error="This session's floor plan no longer exists." /></div>;

  const chosen = data.rooms.filter((r) => r.selection);
  const hoveredRoom = hoveredId && !roomId ? (data.rooms.find((r) => r.room.id === hoveredId) ?? null) : null;
  const anyMissingPreviews = data.rooms.some((r) => r.originalReference && r.tierPreviews.some((t) => t.images.length === 0));
  const anyRoomGenerating = Object.values(generatingRooms).some(Boolean);
  const hasServerPending = data.rooms.some((r) => r.jobs.some((j) => !["completed", "failed", "cancelled"].includes(j.status)));
  const isGeneratingNow = batchGenerating || anyRoomGenerating || hasServerPending;

  async function quickChoose(targetRoomId: string, opts: { referenceId?: string; generatedAssetId?: string | null; previewId?: string | null; tierOfferingId?: string | null }, key: string) {
    setQuickSaving(key);
    setHoverErr(null);
    try {
      await api(`/api/sessions/${sessionId}/selections`, { method: "POST", json: { roomId: targetRoomId, ...opts } });
      await reload();
    } catch (e) {
      setHoverErr((e as Error).message);
    } finally {
      setQuickSaving(null);
    }
  }

  async function generateAllPreviews() {
    setBatchGenerating(true);
    setAiPaused(false);
    setHoverErr(null);
    const ac = new AbortController();
    abortSetRef.current.add(ac);
    try {
      await api(`/api/sessions/${sessionId}/previews`, { method: "POST", json: {}, signal: ac.signal });
      await reload();
    } catch (e) {
      if ((e as Error).name !== "AbortError") setHoverErr((e as Error).message);
    } finally {
      abortSetRef.current.delete(ac);
      setBatchGenerating(false);
    }
  }

  const cardLeftSide = hoverAnchor.xPct > 52;
  const cardTopPct = Math.max(4, Math.min(48, hoverAnchor.yPct - 14));

  return (
    <div className="mx-auto w-full max-w-[1520px] px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-stone-600">{data.property?.city} {data.session.clientName && `· ${data.session.clientName}`}</p>
          <h1 className="font-display text-3xl sm:text-4xl">{data.property?.name}</h1>
          <p className="text-sm text-stone-600">Hover any room on the floor plan for Original + Economy / Premium Economy previews &amp; BOQ. Click any image to enlarge.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-2xl bg-white px-3.5 py-2 text-right ring-1 ring-stone-200">
            <p className="text-[10px] uppercase tracking-wider text-stone-500">Live Floor BOQ Estimate</p>
            <p className="text-sm font-semibold text-ink">
              {formatMoney(data.boqSummary.selectedTotalAmount, data.currency)}{" "}
              <span className="font-normal text-stone-500">· {data.boqSummary.totalFloorAreaSqft.toLocaleString()} sq ft</span>
            </p>
          </div>
          <select
            aria-label="Default offering tier"
            className={`${inputCls} w-auto`}
            value={data.session.offeringId}
            onChange={async (e) => {
              await api(`/api/sessions/${sessionId}`, { method: "PATCH", json: { offeringId: e.target.value } });
              reload();
            }}
          >
            {data.offerings.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          {isGeneratingNow && (
            <Button variant="danger" onClick={stopAllAiGeneration} loading={stoppingAi}>
              <Square className="size-3.5 fill-current" /> Stop generating AI
            </Button>
          )}
          {data.aiAvailable && aiPaused && !isGeneratingNow && (
            <Button variant="secondary" onClick={() => setAiPaused(false)}>
              <Play className="size-3.5" /> Resume AI previews
            </Button>
          )}
          {data.aiAvailable && anyMissingPreviews && !isGeneratingNow && (
            <Button variant="secondary" onClick={generateAllPreviews}>
              <Sparkles className="size-4" /> Prepare all AI previews
            </Button>
          )}
          <Link href={`/atlas/${sessionId}/preview`}>
            <Button><LayoutGrid className="size-4" /> Summary &amp; BOQ ({chosen.length})</Button>
          </Link>
        </div>
      </div>

      {hoverErr && <div className="mb-4"><ErrorNote error={hoverErr} /></div>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-2">
          <div className="relative" onMouseLeave={scheduleLeave}>
            <FloorPlanView
              plan={data.floorPlan}
              activeRoomId={roomId}
              hoveredRoomId={hoveredId}
              roomStates={roomStates}
              roomTypeNames={roomTypeNames}
              onSelect={(id) => {
                setHoveredId(null);
                setRoomId(id);
              }}
              onHoverRoom={handleHoverRoom}
            />

            {hoveredRoom && (
              <div
                onMouseEnter={cancelLeave}
                onMouseLeave={scheduleLeave}
                style={{ top: `${cardTopPct}%` }}
                className={cx(
                  "z-30 mt-3 w-full rounded-2xl bg-white/95 p-4 shadow-2xl ring-1 ring-stone-200 backdrop-blur-md lg:absolute lg:mt-0 lg:w-[min(560px,74%)]",
                  cardLeftSide ? "lg:left-3" : "lg:right-3",
                )}
              >
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-stone-100 pb-2.5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-bronze">{hoveredRoom.room.code} · {hoveredRoom.roomTypeName}</span>
                      <Pill>{hoveredRoom.metrics.floorAreaSqft} sq ft</Pill>
                      {hoveredRoom.metrics.seatCount > 0 && <Pill>{hoveredRoom.metrics.seatCount} seats</Pill>}
                      {hoveredRoom.selection && <Pill tone="good">Chosen: {hoveredRoom.selection.offeringName}</Pill>}
                    </div>
                    <h3 className="font-display text-2xl text-ink">{hoveredRoom.room.name}</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => { setHoveredId(null); setRoomId(hoveredRoom.room.id); }}>
                      Inspect &amp; BOQ <ArrowRight className="size-3.5" />
                    </Button>
                    <button onClick={() => setHoveredId(null)} aria-label="Close hover preview" className="rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-ink">
                      <X className="size-4" />
                    </button>
                  </div>
                </div>

                {generatingRooms[hoveredRoom.room.id] && (
                  <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-planned-soft px-3 py-1.5 text-xs text-planned">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-3.5 animate-spin" /> Generating categorized AI previews from your past project…
                    </span>
                    <button
                      type="button"
                      onClick={stopAllAiGeneration}
                      className="inline-flex items-center gap-1 rounded-full bg-danger px-2.5 py-0.5 text-[11px] font-medium text-white hover:opacity-90"
                    >
                      <Square className="size-2.5 fill-current" /> Stop
                    </button>
                  </div>
                )}

                <div className={cx("grid gap-2.5 sm:grid-cols-2", hoveredRoom.tierPreviews.length <= 2 ? "lg:grid-cols-3" : "lg:grid-cols-4")}>
                  {/* Card 1: Original baseline reference from past project */}
                  <div className="flex flex-col overflow-hidden rounded-xl bg-stone-50 ring-1 ring-stone-200">
                    <div className="group relative h-28 bg-stone-100">
                      {hoveredRoom.originalReference ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openLightbox({
                              src: hoveredRoom.originalReference!.imageUrl,
                              title: `${hoveredRoom.room.name} · Original`,
                              subtitle: `${hoveredRoom.originalReference!.project.name} (${hoveredRoom.originalReference!.referenceCode})`,
                            });
                          }}
                          className="relative block size-full cursor-zoom-in"
                          aria-label="Enlarge original image"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={hoveredRoom.originalReference.thumbUrl} alt="Original" className="size-full object-cover" />
                          <ZoomBadge className="right-1.5 top-1.5" />
                        </button>
                      ) : (
                        <div className="flex size-full items-center justify-center px-2 text-center text-[11px] text-stone-400">No approved reference yet</div>
                      )}
                      <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-ink/85 px-2 py-0.5 text-[10px] font-medium text-white">1. Original</span>
                    </div>
                    <div className="flex flex-1 flex-col justify-between p-2">
                      <div>
                        <p className="truncate text-xs font-medium text-ink">
                          {hoveredRoom.originalReference ? hoveredRoom.originalReference.project.name : "No reference"}
                        </p>
                        <p className="truncate text-[10px] text-stone-500">Past project baseline</p>
                      </div>
                      {hoveredRoom.originalReference && (
                        <button
                          onClick={() => quickChoose(hoveredRoom.room.id, { referenceId: hoveredRoom.originalReference!.id }, `orig:${hoveredRoom.room.id}`)}
                          disabled={quickSaving === `orig:${hoveredRoom.room.id}`}
                          className="mt-2 w-full rounded-lg bg-white py-1 text-[11px] font-medium text-ink ring-1 ring-stone-200 hover:bg-stone-100"
                        >
                          {hoveredRoom.selection && !hoveredRoom.selection.generatedAssetId && hoveredRoom.selection.referenceId === hoveredRoom.originalReference.id
                            ? "Selected ✓"
                            : "Choose Original"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Tiered AI cards: Economy, Premium Economy */}
                  {hoveredRoom.tierPreviews.map((tp, idx) => {
                    const firstImg = tp.images[0] ?? null;
                    const chosenThis = Boolean(
                      hoveredRoom.selection &&
                        ((firstImg?.generatedAssetId && hoveredRoom.selection.generatedAssetId === firstImg.generatedAssetId) ||
                          (hoveredRoom.selection.offeringId === tp.offering.id && hoveredRoom.selection.generatedAssetId)),
                    );
                    const saveKey = `tier:${hoveredRoom.room.id}:${tp.offering.id}`;
                    return (
                      <div key={tp.offering.id} className={cx("flex flex-col overflow-hidden rounded-xl ring-1 transition", chosenThis ? "bg-bronze/5 ring-bronze" : "bg-white ring-stone-200")}>
                        <div className="group relative h-28 bg-stone-100">
                          {firstImg ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openLightbox({
                                  src: firstImg.url,
                                  title: `${hoveredRoom.room.name} · ${tp.offering.name}`,
                                  subtitle: `${formatMoney(tp.boq.totalAmount, data.currency)} (${formatMoney(tp.boq.costPerSqft, data.currency)}/sq ft)`,
                                });
                              }}
                              className="relative block size-full cursor-zoom-in"
                              aria-label={`Enlarge ${tp.offering.name} preview`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={firstImg.url} alt={tp.offering.name} className="size-full object-cover" />
                              <ZoomBadge className="right-1.5 top-1.5" />
                            </button>
                          ) : generatingRooms[hoveredRoom.room.id] ? (
                            <div className="flex size-full flex-col items-center justify-center gap-1 text-[10px] text-stone-500">
                              <Loader2 className="size-4 animate-spin text-bronze" /> Rendering…
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setAiPaused(false);
                                autoAttemptedRef.current.delete(hoveredRoom.room.id);
                                triggerAutoPreview(hoveredRoom.room.id);
                              }}
                              className="flex size-full flex-col items-center justify-center gap-1 px-2 text-center text-[10px] text-stone-500 hover:bg-stone-50"
                            >
                              <Sparkles className="size-3.5 text-bronze" /> {hoveredRoom.originalReference && data.aiAvailable ? "Generate preview" : "View details"}
                            </button>
                          )}
                          <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-semibold text-ink shadow-sm">
                            {idx + 2}. {tp.offering.name}
                          </span>
                        </div>
                        <div className="flex flex-1 flex-col justify-between p-2">
                          <div>
                            <p className="text-xs font-semibold text-ink">{formatMoney(tp.boq.totalAmount, data.currency)}</p>
                            <p className="text-[10px] text-stone-500">{formatMoney(tp.boq.costPerSqft, data.currency)} / sq ft</p>
                          </div>
                          {firstImg ? (
                            <button
                              onClick={() =>
                                quickChoose(
                                  hoveredRoom.room.id,
                                  {
                                    referenceId: firstImg.referenceId ?? undefined,
                                    generatedAssetId: firstImg.generatedAssetId,
                                    previewId: firstImg.previewId,
                                    tierOfferingId: tp.offering.id,
                                  },
                                  saveKey,
                                )
                              }
                              disabled={quickSaving === saveKey}
                              className={cx(
                                "mt-2 inline-flex w-full items-center justify-center gap-1 rounded-lg py-1 text-[11px] font-medium transition",
                                chosenThis ? "bg-bronze text-white" : "bg-ink text-paper hover:bg-stone-800",
                              )}
                            >
                              {chosenThis && <Check className="size-3" />} {chosenThis ? "Selected" : `Choose ${tp.offering.name}`}
                            </button>
                          ) : (
                            <button
                              onClick={() => { setHoveredId(null); setRoomId(hoveredRoom.room.id); }}
                              className="mt-2 w-full rounded-lg bg-stone-100 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-200"
                            >
                              See BOQ
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <p className="text-xs text-stone-600">Green rooms already have a chosen design. Hover any room to compare 1 Original + AI tier packages, or click any image to enlarge.</p>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <div className="rounded-3xl bg-white p-4 ring-1 ring-stone-100">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-xl">Rooms &amp; BOQ</p>
              <span className="text-xs text-stone-500">{chosen.length}/{data.rooms.length} chosen</span>
            </div>
            <ul className="space-y-2">
              {data.rooms.map((r) => {
                const img = r.selection?.generatedImageUrl ?? r.selection?.reference?.thumbUrl;
                const fullImg = r.selection?.generatedImageUrl ?? r.selection?.reference?.imageUrl ?? img;
                return (
                  <li key={r.room.id}>
                    <div
                      onMouseEnter={() => handleHoverRoom(r.room.id, { xPct: 20, yPct: 25 })}
                      onClick={() => { setHoveredId(null); setRoomId(r.room.id); }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (setHoveredId(null), setRoomId(r.room.id))}
                      className={cx(
                        "flex w-full cursor-pointer items-center gap-3 rounded-xl p-2 text-left transition hover:bg-stone-50",
                        (roomId === r.room.id || hoveredId === r.room.id) && "bg-stone-50 ring-1 ring-stone-200",
                      )}
                    >
                      {img && fullImg ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openLightbox({ src: fullImg, title: r.room.name, subtitle: r.selection?.offeringName ?? r.roomTypeName });
                          }}
                          className="group relative h-12 w-16 shrink-0 cursor-zoom-in overflow-hidden rounded-lg"
                          aria-label={`Enlarge ${r.room.name} image`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img} alt="" className="size-full object-cover" />
                          <ZoomBadge className="right-0.5 top-0.5 p-1" />
                        </button>
                      ) : (
                        <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-[10px] text-stone-400">Preview</span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{r.room.name}</span>
                        <span className="block truncate text-xs text-stone-600">
                          {r.metrics.floorAreaSqft} sq ft · {r.selection ? r.selection.offeringName : r.roomTypeName}
                        </span>
                        <span className="block text-[11px] font-medium text-bronze">{formatMoney(r.selectedBoq.totalAmount, data.currency)}</span>
                      </span>
                      <ArrowRight className="size-3.5 text-stone-400" />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-3xl bg-white p-4 ring-1 ring-stone-100">
            <div className="mb-2 flex items-center gap-2">
              <Calculator className="size-4 text-bronze" />
              <p className="font-display text-lg">Full Floor Package Comparison</p>
            </div>
            <div className="space-y-1.5 text-xs">
              {data.boqSummary.tierComparison.map((tc) => (
                <div key={tc.offeringId} className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2">
                  <div>
                    <p className="font-medium text-ink">{tc.offeringName}</p>
                    <p className="text-[10px] text-stone-500">{formatMoney(tc.costPerSqft, data.currency)} / sq ft</p>
                  </div>
                  <p className="font-semibold text-ink">{formatMoney(tc.totalAmount, data.currency)}</p>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <RoomOptionsModal key={roomId ?? "none"} sessionId={sessionId} roomId={roomId} onClose={() => setRoomId(null)} onChosen={reload} />
      {lightboxNode}
    </div>
  );
}
