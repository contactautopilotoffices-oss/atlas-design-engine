"use client";
import { Mail, Printer } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { ProjectBoqPanel, RoomBoqTable } from "@/components/boq-summary";
import { useLightbox, ZoomBadge } from "@/components/lightbox";
import { Button, ErrorNote, inputCls, Pill, Spinner, StageBadge, Swatches } from "@/components/ui";
import { formatMoney } from "@/modules/boq/calculator";
import type { handoffSummary } from "@/modules/handoff/summary";

type Handoff = Awaited<ReturnType<typeof handoffSummary>> & { email: { configured: boolean; reason?: string } };

export default function HandoffPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { openLightbox, lightboxNode } = useLightbox();
  const [h, setH] = useState<Handoff | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    api<Handoff>(`/api/handoff/${sessionId}`).then(setH).catch((e) => setErr(e.message));
  }, [sessionId]);
  if (err) return <div className="mx-auto max-w-3xl p-10"><ErrorNote error={err} /></div>;
  if (!h) return <div className="p-10"><Spinner /></div>;

  async function send() {
    setSending(true);
    setMsg(null);
    try {
      await api(`/api/handoff/${sessionId}`, { method: "POST", json: { to } });
      setMsg("Sent.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <header className="mb-8 border-b border-stone-200 pb-6">
        <p className="text-xs uppercase tracking-[0.24em] text-bronze">Final selection summary</p>
        <h1 className="font-display text-4xl">{h.property?.name}</h1>
        <p className="text-sm text-stone-600">
          {h.property?.city} · {h.session.clientName || "Client"} · Offering: {h.offering?.name} · {new Date().toLocaleDateString()}
        </p>
        {h.floorPlanIsSample && <p className="mt-2 text-xs text-planned">Based on a sample floor plan, not surveyed property geometry.</p>}
        <div className="no-print mt-4 flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" /> Print or save as PDF</Button>
          <div className="flex items-center gap-2 rounded-full bg-white p-1 pl-3 ring-1 ring-stone-200">
            <Mail className="size-4 text-stone-400" />
            <input className={`${inputCls} w-56 border-0 py-1 focus:ring-0`} placeholder="client@email.com" value={to} onChange={(e) => setTo(e.target.value)} disabled={!h.email.configured} />
            <Button size="sm" onClick={send} loading={sending} disabled={!h.email.configured || !to}>Email summary</Button>
          </div>
          <StageBadge state={h.email.configured ? "built-unverified" : "built-awaiting-config"} />
          {!h.email.configured && <span className="text-xs text-stone-600">{h.email.reason}</span>}
          {msg && <span className="text-xs">{msg}</span>}
        </div>
      </header>
      <div className="mb-6">
        <ProjectBoqPanel boq={h.boqSummary} filePrefix={`handoff-boq-${h.session.id.slice(-8)}`} />
      </div>
      <p className="mb-4 text-sm">Designer approval: <b>{h.designerApproval}</b></p>
      <div className="space-y-8">
        {h.rooms.map((r) => (
          <section key={r.roomId} className="break-inside-avoid space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-2xl">{r.roomName} <span className="text-base text-stone-600">· {r.roomTypeName} · {r.selectedBoq.metrics.floorAreaSqft} sq ft</span></h2>
              <div className="flex items-center gap-2">
                <Pill tone="good">{r.offeringName} · {formatMoney(r.selectedBoq.totalAmount, h.currency)}</Pill>
                <Pill>Revision {r.revision}</Pill>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
              {r.chosenAiImageUrl && (
                <figure>
                  <button
                    type="button"
                    onClick={() => openLightbox({ src: r.chosenAiImageUrl!, title: r.roomName, subtitle: r.offeringName })}
                    className="group relative block w-full cursor-zoom-in overflow-hidden rounded-2xl"
                    aria-label={`Enlarge ${r.roomName} AI design`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.chosenAiImageUrl} alt="" className="w-full rounded-2xl" />
                    <ZoomBadge className="right-2.5 top-2.5" />
                  </button>
                  <figcaption className="mt-1 text-xs text-stone-600">Chosen AI design, based on {r.reference?.referenceCode} · {r.reference?.project.name}. Inspiration only; not to exact dimensions.</figcaption>
                </figure>
              )}
              {r.reference && !r.chosenAiImageUrl && (
                <figure>
                  <button
                    type="button"
                    onClick={() => openLightbox({ src: r.reference!.imageUrl, title: r.roomName, subtitle: `${r.reference!.referenceCode} · ${r.reference!.project.name}` })}
                    className="group relative block w-full cursor-zoom-in overflow-hidden rounded-2xl"
                    aria-label={`Enlarge ${r.roomName} reference`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.reference.imageUrl} alt="" className="w-full rounded-2xl" />
                    <ZoomBadge className="right-2.5 top-2.5" />
                  </button>
                  <figcaption className="mt-1 text-xs text-stone-600">
                    Chosen reference {r.reference.referenceCode} · {r.reference.project.name} · {r.reference.source.filename}
                    {r.reference.source.page ? `, page ${r.reference.source.page}` : ""} {r.reference.isDemo && <Pill tone="demo">DEMO</Pill>}
                  </figcaption>
                </figure>
              )}
              <div className="space-y-2 text-sm">
                {r.reference && <Swatches palette={r.reference.palette} size="md" />}
                <p><span className="text-stone-600">Materials:</span> {r.reference?.materials.join(", ") || "not recorded"}</p>
                <p><span className="text-stone-600">Offering:</span> {r.offeringName}</p>
                <p><span className="text-stone-600">Dimensions:</span> {r.dimensions ? `${r.dimensions.length} x ${r.dimensions.width} x ${r.dimensions.height} ${r.dimensions.unit}${r.dimensions.valid ? "" : " (has validation errors)"}` : "not measured"}</p>
                {r.latestDesignerNote && <p><span className="text-stone-600">Designer note:</span> {r.latestDesignerNote}</p>}
                <RoomBoqTable boq={r.selectedBoq} currency={h.currency} />
                {r.generated.length > 0 && (
                  <div>
                    <p className="mb-1 text-stone-600">AI concepts ({r.generated.length}) · approved shown first</p>
                    <div className="grid grid-cols-3 gap-2">
                      {[...r.generated].sort((a, b) => Number(b.isHandoffAsset) - Number(a.isHandoffAsset)).map((g) => (
                        <div key={g.id} className="group relative">
                          <button
                            type="button"
                            onClick={() => openLightbox({ src: g.url, title: `${r.roomName} · AI Concept` })}
                            className="relative block w-full cursor-zoom-in overflow-hidden rounded-lg"
                            aria-label="Enlarge AI concept"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={g.url} alt="" className="w-full rounded-lg" />
                            <ZoomBadge className="right-1 top-1 p-1" />
                          </button>
                          <span className="pointer-events-none absolute left-1 top-1"><Pill tone={g.isHandoffAsset ? "good" : "neutral"}>{g.isHandoffAsset ? "Approved" : g.reviewStatus.replace("_", " ")}</Pill></span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-1 text-[11px] text-stone-400">AI concepts are inspiration only and do not certify dimensions.</p>
                  </div>
                )}
              </div>
            </div>
          </section>
        ))}
      </div>
      {lightboxNode}
    </div>
  );
}
