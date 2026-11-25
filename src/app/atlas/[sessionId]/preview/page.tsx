"use client";
import { ArrowLeft, FileText, Pencil, Printer } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "@/components/session";
import { Button, Empty, ErrorNote, Pill, Spinner, Swatches } from "@/components/ui";

export default function PreviewRooms() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { data, err } = useSession(sessionId);
  if (err) return <div className="mx-auto max-w-3xl p-10"><ErrorNote error={err} /></div>;
  if (!data) return <div className="p-10"><Spinner /></div>;
  const selected = data.rooms.filter((r) => r.selection);
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href={`/atlas/${sessionId}`} className="mb-2 inline-flex items-center gap-1 text-sm text-stone-600 hover:text-ink">
            <ArrowLeft className="size-4" /> Back to floor plan
          </Link>
          <h1 className="font-display text-4xl">Selected rooms</h1>
          <p className="text-sm text-stone-600">
            {data.property?.name} · Offering: {data.offering?.name} · Session {data.session.id.slice(-8)} · started {new Date(data.session.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/handoff/${sessionId}`}><Button variant="secondary"><FileText className="size-4" /> Selection summary</Button></Link>
          <Button variant="ghost" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
        </div>
      </div>
      {selected.length === 0 && <Empty title="No rooms submitted yet">Open the floor plan, choose a room, select an image and press Submit choice.</Empty>}
      <div className="space-y-5">
        {selected.map((r) => {
          const ref = r.selection!.reference;
          return (
            <article key={r.room.id} className="grid gap-5 rounded-3xl bg-white p-4 ring-1 ring-stone-100 md:grid-cols-[320px_1fr]">
              {r.selection!.generatedImageUrl || ref ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.selection!.generatedImageUrl ?? ref!.imageUrl} alt={r.room.name} className="h-60 w-full rounded-2xl object-cover" />
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center rounded-2xl bg-stone-50 text-xs text-stone-600">Reference no longer available</div>
              )}
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-stone-600">{r.room.code} · {r.roomTypeName}</p>
                    <h2 className="font-display text-2xl">{r.room.name}</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <Pill tone="good">Revision {r.selection!.revision}</Pill>
                    {ref?.isDemo && <Pill tone="demo">DEMO</Pill>}
                    <Link href={`/atlas/${sessionId}?room=${r.room.id}`}>
                      <Button size="sm" variant="secondary"><Pencil className="size-3.5" /> Revise</Button>
                    </Link>
                  </div>
                </div>
                <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <div><dt className="text-stone-600">{r.selection!.generatedAssetId ? "AI design based on" : "Reference"}</dt><dd>{r.selection!.snapshot.referenceCode}</dd></div>
                  <div><dt className="text-stone-600">Source project</dt><dd>{r.selection!.snapshot.projectName}</dd></div>
                  <div><dt className="text-stone-600">Source</dt><dd>{r.selection!.snapshot.sourceFilename}{r.selection!.snapshot.sourcePage ? `, page/slide ${r.selection!.snapshot.sourcePage}` : ""}</dd></div>
                  <div><dt className="text-stone-600">Offering</dt><dd>{r.selection!.offeringName}</dd></div>
                  {ref && <div><dt className="text-stone-600">Materials</dt><dd>{ref.materials.join(", ") || "not recorded"}</dd></div>}
                  {ref && <div><dt className="text-stone-600">Palette</dt><dd><Swatches palette={ref.palette} /></dd></div>}
                  <div><dt className="text-stone-600">Submitted</dt><dd>{new Date(r.selection!.submittedAt).toLocaleString()}</dd></div>
                </dl>
                {r.revisions.length > 1 && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-stone-600">Revision history</p>
                    <ol className="flex flex-wrap gap-2">
                      {r.revisions.map((v) => (
                        <li key={v.id} className="flex items-center gap-2 rounded-xl bg-stone-50 p-1.5 pr-3 text-xs">
                          {(v.generatedImageUrl || v.reference) && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={v.generatedImageUrl ?? v.reference!.thumbUrl} alt="" className="h-8 w-12 rounded object-cover" />
                          )}
                          Rev {v.revision} · {v.snapshot.referenceCode}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <p className="mt-8 text-xs text-stone-600">Submit saves a choice. It does not generate an image or send an email.</p>
    </div>
  );
}
