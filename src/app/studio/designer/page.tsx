"use client";
import { Check, FileText, MessageSquare, RotateCcw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/api";
import type { RoomSummary, SessionSummary } from "@/components/session";
import { Button, cx, Empty, ErrorNote, inputCls, Pill, Spinner, Swatches } from "@/components/ui";

type QueueItem = { sessionId: string; clientName: string; propertyName: string; createdAt: string; selectedRooms: number; generated: number; awaitingReview: number; approved: number };

function RoomReview({ sessionId, r, onChange }: { sessionId: string; r: RoomSummary; onChange: () => void }) {
  const [comment, setComment] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const act = async (action: string, generatedAssetId: string | null) => {
    setErr(null);
    try {
      await api("/api/reviews", { method: "POST", json: { sessionId, roomId: r.room.id, generatedAssetId, action, comment } });
      setComment("");
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const ref = r.selection?.reference;
  const s = r.spec?.spec;
  return (
    <article className="space-y-3 rounded-3xl bg-white p-5 ring-1 ring-stone-100">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-xl">{r.room.name} <span className="text-sm text-stone-600">· {r.roomTypeName}</span></h3>
        <div className="text-xs text-stone-600">
          {s ? `${s.length} x ${s.width} x ${s.height} ${s.unit} · ${s.doors.length} door(s), ${s.windows.length} window(s) · occupancy ${s.occupancy}` : "No measurements saved"}
          {r.spec && !r.spec.isValid && <Pill tone="bad">measurements have errors</Pill>}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-stone-600">Client&apos;s reference</p>
          {ref ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ref.imageUrl} alt="" className="w-full rounded-xl" />
              <p className="mt-1 text-xs">{ref.referenceCode} · {ref.project.name} · rev {r.selection!.revision}</p>
              <Swatches palette={ref.palette} />
            </>
          ) : (
            <p className="text-xs text-stone-600">No submitted choice.</p>
          )}
        </div>
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-stone-600">Generated alternatives</p>
          {r.assets.length === 0 && <p className="text-xs text-stone-600">None yet.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {r.assets.map((a) => {
              const job = r.jobs.find((j) => j.id === a.jobId);
              return (
                <div key={a.id} className={cx("space-y-1.5 rounded-xl p-2", a.reviewStatus === "approved" ? "bg-live-soft" : "bg-stone-50")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/assets/generated-images/${a.blobKey}`} alt="" className="w-full rounded-lg" />
                  <div className="flex flex-wrap items-center gap-1 text-[11px]">
                    <Pill tone={a.reviewStatus === "approved" ? "good" : a.reviewStatus === "rejected" ? "bad" : "warn"}>{a.reviewStatus.replace("_", " ")}</Pill>
                    {a.isHandoffAsset && <Pill tone="good">handoff asset</Pill>}
                    <span className="text-stone-600">{job?.modelId} · refs {job?.referenceInputs.map((x) => x.role).join(", ")}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" onClick={() => act("approve", a.id)}><Check className="size-3" /> Approve</Button>
                    <Button size="sm" variant="secondary" onClick={() => act("request_iteration", a.id)}><RotateCcw className="size-3" /> Iterate</Button>
                    <Button size="sm" variant="ghost" onClick={() => act("reject", a.id)}><X className="size-3" /> Reject</Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto text-danger"
                      onClick={async () => {
                        if (!confirm("Delete this generated image?")) return;
                        setErr(null);
                        try {
                          await api(`/api/generated-assets/${a.id}`, { method: "DELETE" });
                          onChange();
                        } catch (e) {
                          setErr((e as Error).message);
                        }
                      }}
                    >
                      <Trash2 className="size-3" /> Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <input className={inputCls} placeholder="Comment for this room (also saved with any action above)" value={comment} onChange={(e) => setComment(e.target.value)} />
        <Button variant="secondary" onClick={() => act("comment", null)}><MessageSquare className="size-4" /> Comment</Button>
      </div>
      <ErrorNote error={err} />
      {r.reviews.length > 0 && (
        <ul className="space-y-1 border-t border-stone-100 pt-2 text-xs text-stone-600">
          {r.reviews.map((v) => (
            <li key={v.id}><b>{v.action.replace("_", " ")}</b> by {v.reviewer} · {new Date(v.createdAt).toLocaleString()} {v.comment && `· "${v.comment}"`}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

export default function DesignerPage() {
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const loadQueue = useCallback(() => api<{ queue: QueueItem[] }>("/api/reviews").then((d) => setQueue(d.queue)).catch((e) => setErr(e.message)), []);
  const loadDetail = useCallback(() => {
    if (current) api<SessionSummary>(`/api/sessions/${current}`).then(setDetail).catch((e) => setErr(e.message));
  }, [current]);
  useEffect(() => {
    loadQueue();
  }, [loadQueue]);
  useEffect(loadDetail, [loadDetail]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl">Designer approval</h1>
        <p className="text-sm text-stone-600">Compare each client&apos;s chosen reference with the generated alternatives. AI images are never approved automatically.</p>
      </div>
      <ErrorNote error={err} />
      {!queue && <Spinner />}
      {queue && queue.length === 0 && <Empty title="Review queue is empty">Sessions appear here once a client submits room choices.</Empty>}
      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <ul className="space-y-2">
          {queue?.map((q) => (
            <li key={q.sessionId} className="flex items-start gap-1">
              <button onClick={() => setCurrent(q.sessionId)} className={cx("w-full rounded-2xl bg-white p-3 text-left ring-1", current === q.sessionId ? "ring-2 ring-bronze" : "ring-stone-100")}>
                <p className="text-sm font-medium">{q.clientName || "Unnamed client"} · {q.propertyName}</p>
                <p className="text-xs text-stone-600">{new Date(q.createdAt).toLocaleDateString()} · {q.selectedRooms} rooms · {q.generated} images</p>
                {q.awaitingReview > 0 && <Pill tone="warn">{q.awaitingReview} awaiting review</Pill>} {q.approved > 0 && <Pill tone="good">{q.approved} approved</Pill>}
              </button>
              <button
                aria-label="Delete session"
                className="mt-2 rounded-full p-1.5 text-stone-400 hover:bg-stone-100 hover:text-danger"
                onClick={async () => {
                  if (!confirm(`Delete session for ${q.clientName || "Unnamed client"}?`)) return;
                  await api(`/api/sessions/${q.sessionId}`, { method: "DELETE" });
                  if (current === q.sessionId) {
                    setCurrent(null);
                    setDetail(null);
                  }
                  loadQueue();
                }}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
        <div className="space-y-4">
          {detail && current && (
            <>
              <div className="flex justify-end"><Link href={`/handoff/${current}`}><Button variant="secondary" size="sm"><FileText className="size-3.5" /> Handoff summary</Button></Link></div>
              {detail.rooms.filter((r) => r.selection || r.assets.length).map((r) => (
                <RoomReview key={r.room.id} sessionId={current} r={r} onChange={() => { loadDetail(); loadQueue(); }} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
