"use client";
import { ArrowRight, LayoutGrid } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { api } from "@/components/api";
import { FloorPlanView, type RoomState } from "@/components/floor-plan";
import { useConfig } from "@/components/references";
import { RoomOptionsModal } from "@/components/room-options";
import { useSession } from "@/components/session";
import { Button, cx, ErrorNote, inputCls, Spinner } from "@/components/ui";

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
  const [roomId, setRoomId] = useState<string | null>(search.get("room"));

  const roomTypeNames = useMemo(() => Object.fromEntries((config?.roomTypes ?? []).map((r) => [r.id, r.name])), [config]);
  const roomStates = useMemo(() => Object.fromEntries((data?.rooms ?? []).map((r) => [r.room.id, (r.selection ? "submitted" : "empty") as RoomState])), [data]);

  if (err) return <div className="mx-auto max-w-3xl p-10"><ErrorNote error={err} /></div>;
  if (!data || !config) return <div className="p-10"><Spinner label="Opening floor plan" /></div>;
  if (!data.floorPlan) return <div className="p-10"><ErrorNote error="This session's floor plan no longer exists." /></div>;
  const chosen = data.rooms.filter((r) => r.selection);

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-stone-600">{data.property?.city} {data.session.clientName && `· ${data.session.clientName}`}</p>
          <h1 className="font-display text-3xl sm:text-4xl">{data.property?.name}</h1>
          <p className="text-sm text-stone-600">Click any room to see design options.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Offering"
            className={`${inputCls} w-auto`}
            value={data.session.offeringId}
            onChange={async (e) => {
              await api(`/api/sessions/${sessionId}`, { method: "PATCH", json: { offeringId: e.target.value } });
              reload();
            }}
          >
            {data.offerings.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <Link href={`/atlas/${sessionId}/preview`}><Button variant="secondary"><LayoutGrid className="size-4" /> Summary ({chosen.length})</Button></Link>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-2">
          <FloorPlanView plan={data.floorPlan} activeRoomId={roomId} roomStates={roomStates} roomTypeNames={roomTypeNames} onSelect={setRoomId} />
          <p className="text-xs text-stone-600">Green rooms already have a chosen design.</p>
        </div>
        <aside className="rounded-3xl bg-white p-4 ring-1 ring-stone-100 xl:sticky xl:top-20 xl:self-start">
          <p className="mb-3 font-display text-xl">Your choices</p>
          <ul className="space-y-2">
            {data.rooms.map((r) => {
              const img = r.selection?.generatedImageUrl ?? r.selection?.reference?.thumbUrl;
              return (
                <li key={r.room.id}>
                  <button onClick={() => setRoomId(r.room.id)} className={cx("flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-stone-50", roomId === r.room.id && "bg-stone-50")}>
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt="" className="h-12 w-16 rounded-lg object-cover" />
                    ) : (
                      <span className="flex h-12 w-16 items-center justify-center rounded-lg bg-stone-100 text-[10px] text-stone-400">Not chosen</span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.room.name}</span>
                      <span className="block truncate text-xs text-stone-600">{r.selection ? (r.selection.generatedAssetId ? "AI design" : `From ${r.selection.snapshot.projectName}`) : r.roomTypeName}</span>
                    </span>
                    <ArrowRight className="size-3.5 text-stone-400" />
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>

      <RoomOptionsModal key={roomId ?? "none"} sessionId={sessionId} roomId={roomId} onClose={() => setRoomId(null)} onChosen={reload} />
    </div>
  );
}
