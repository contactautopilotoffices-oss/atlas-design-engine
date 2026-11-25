"use client";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/api";
import { Empty, ErrorNote, Pill, Spinner, StageBadge } from "@/components/ui";
import type { GenerationJob } from "@/modules/core/schemas";

type ProviderInfo = { configured: boolean; credentialVariable: string | null; problem: string | null };

export default function GenerationActivity() {
  const [jobs, setJobs] = useState<GenerationJob[] | null>(null);
  const [status, setStatus] = useState<{ higgsfield: ProviderInfo; openai?: ProviderInfo } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    api<{ jobs: GenerationJob[] }>("/api/generation/jobs").then((d) => setJobs(d.jobs)).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    load();
    api<typeof status>("/api/status").then(setStatus).catch(() => undefined);
  }, [load]);

  async function removeJob(id: string) {
    if (!confirm("Delete this generation job and any images it produced?")) return;
    setErr(null);
    try {
      await api(`/api/generation/jobs/${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const count = (s: string) => jobs?.filter((j) => j.status === s).length ?? 0;
  const anyConfigured = Boolean(status?.openai?.configured || status?.higgsfield.configured);
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="font-display text-3xl">AI generation activity</h1>
          {status && <StageBadge state={anyConfigured ? "built-unverified" : "built-awaiting-config"} />}
        </div>
        <div className="mt-1 space-y-0.5 text-sm text-stone-600">
          <p>Every OpenAI and Higgsfield generation request, its model, settings, references and outcome.</p>
          {status && (
            <>
              <p className="text-xs">
                <b>OpenAI:</b> {status.openai?.configured ? `configured in ${status.openai.credentialVariable} (value never displayed)` : (status.openai?.problem ?? "Not configured")}
              </p>
              <p className="text-xs">
                <b>Higgsfield:</b> {status.higgsfield.configured ? `configured in ${status.higgsfield.credentialVariable} (value never displayed)` : status.higgsfield.problem}
              </p>
            </>
          )}
        </div>
        {jobs && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Pill>{jobs.length} jobs</Pill>
            <Pill tone="good">{count("completed")} completed</Pill>
            <Pill tone="bad">{count("failed")} failed</Pill>
            <Pill tone="warn">{count("queued") + count("submitted") + count("processing")} in progress</Pill>
            <Pill>{count("cancelled")} cancelled</Pill>
          </div>
        )}
        <p className="mt-1 text-[11px] text-stone-400">Check your OpenAI Platform or Higgsfield console for billing details.</p>
      </div>
      <ErrorNote error={err} />
      {!jobs && !err && <Spinner />}
      {jobs && jobs.length === 0 && <Empty title="No generation requests yet" />}
      {jobs && jobs.length > 0 && (
        <div className="overflow-x-auto rounded-3xl bg-white ring-1 ring-stone-100">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs text-stone-600">
              <tr>{["When", "Status", "Model", "Settings", "References", "Provider / usage", "By", "Error / note", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t border-stone-100 align-top">
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{new Date(j.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2"><Pill tone={j.status === "completed" ? "good" : j.status === "failed" ? "bad" : "warn"}>{j.status}</Pill></td>
                  <td className="px-3 py-2 text-xs">{j.modelId}</td>
                  <td className="px-3 py-2 text-xs">{Object.entries(j.settings).map(([k, v]) => `${k}: ${v}`).join(", ")}</td>
                  <td className="px-3 py-2 text-xs">{j.referenceInputs.map((r) => `${r.role}${r.kind === "generated" ? " (refine)" : ""}`).join(", ") || "text only"}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{j.providerRequestId ?? j.costNote}</td>
                  <td className="px-3 py-2 text-xs">{j.createdBy}</td>
                  <td className="max-w-[260px] px-3 py-2 text-xs text-danger">{j.error}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Link className="underline" href={`/atlas/${j.sessionId}/rooms/${j.roomId}/visualise`}>Open</Link>
                      <button aria-label="Delete job" className="text-stone-400 hover:text-danger" onClick={() => removeJob(j.id)}><Trash2 className="size-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
