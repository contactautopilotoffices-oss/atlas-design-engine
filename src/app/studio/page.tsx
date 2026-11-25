"use client";
import { ArrowRight, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { cx, ErrorNote, Spinner, StageBadge } from "@/components/ui";
import type { Feature } from "@/modules/core/status";

type Status = {
  features: Feature[];
  persistence: { kind: string; durable: boolean; detail: string };
  higgsfield: { configured: boolean; credentialVariable: string | null; problem: string | null };
  openai?: { configured: boolean; credentialVariable: string | null; problem: string | null };
};

const LANES: Array<{ title: string; keys: string[]; tint: string }> = [
  { title: "Reference library", keys: ["ingestion", "extraction", "records", "analysis", "review", "gallery"], tint: "bg-[#eef0f6]" },
  { title: "Client flow", keys: ["client-flow", "persistence"], tint: "bg-[#e9f3ef]" },
  { title: "Next stages", keys: ["supabase", "measured-scene", "openai", "higgsfield", "designer-review", "handoff", "email"], tint: "bg-[#fbf3e8]" },
];

export default function StudioStatus() {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<Status>("/api/status").then(setS).catch((e) => setErr(e.message));
  }, []);
  if (err) return <ErrorNote error={err} />;
  if (!s) return <Spinner />;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">From project references to client choices</h1>
        <p className="text-sm text-stone-600">Live status of every stage, computed from this server&apos;s actual configuration.</p>
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          <span className="inline-flex items-center gap-2"><span className="h-0.5 w-8 bg-live" /> Working (live)</span>
          <span className="inline-flex items-center gap-2"><span className="h-0 w-8 border-t-2 border-dashed border-planned" /> Not live yet (awaiting configuration, unverified or planned)</span>
        </div>
      </div>
      {LANES.map((lane) => (
        <section key={lane.title} className={cx("rounded-3xl p-4", lane.tint)}>
          <h2 className="mb-3 font-display text-xl">{lane.title}</h2>
          <div className="flex flex-wrap items-stretch gap-2">
            {lane.keys.map((k, i) => {
              const f = s.features.find((x) => x.key === k)!;
              const live = f.state === "live";
              return (
                <div key={k} className="flex items-center gap-2">
                  <div className={cx("w-56 rounded-2xl bg-white p-3", live ? "live-outline" : "planned-outline")}>
                    <p className="text-sm font-medium leading-snug">{f.label}</p>
                    <StageBadge state={f.state} className="mt-2" />
                    <p className="mt-2 text-[11px] leading-snug text-stone-600">{f.detail}</p>
                  </div>
                  {i < lane.keys.length - 1 && <ArrowRight className={cx("size-4 shrink-0", live ? "text-live" : "text-planned")} />}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <p className="flex items-center gap-2 text-sm text-stone-600"><Info className="size-4" /> Submit saves a choice. It does not generate an image or send an email.</p>
    </div>
  );
}
