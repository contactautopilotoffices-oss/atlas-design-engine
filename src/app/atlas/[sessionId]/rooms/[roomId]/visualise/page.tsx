"use client";
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, Circle, ImagePlus, Loader2, RefreshCw, Sparkles, Square, Trash2, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/components/api";
import { useLightbox, ZoomBadge } from "@/components/lightbox";
import type { ReferenceView } from "@/components/references";
import { useSession } from "@/components/session";
import { Button, cx, ErrorNote, Field, inputCls, Modal, Pill, Spinner, StageBadge } from "@/components/ui";
import type { DesignBrief, GenerationJob, ReferenceRole } from "@/modules/core/schemas";
import type { ModelCapability } from "@/modules/generation/models";

type ProviderInfo = { configured: boolean; credentialVariable: string | null; problem: string | null };
type Preview = {
  brief: DesignBrief;
  prompt: { prompt: string; negativePrompt: string };
  model: ModelCapability;
  models: ModelCapability[];
  imagesSent: number;
  warnings: string[];
  blockers: string[];
  provider: ProviderInfo;
  providers?: { higgsfield: ProviderInfo; openai: ProviderInfo };
};
type JobView = { job: GenerationJob; assets: Array<{ id: string; url: string; reviewStatus: string; isHandoffAsset: boolean }> };

const ROLES: Array<{ v: ReferenceRole; l: string }> = [
  { v: "secondary", l: "Secondary design" },
  { v: "colour", l: "Colour palette" },
  { v: "material", l: "Materials" },
  { v: "lighting", l: "Lighting" },
  { v: "layout", l: "Layout" },
];
const TERMINAL = ["completed", "failed", "cancelled"];
const statusTone = (s: string) => (s === "completed" ? "good" : s === "failed" ? "bad" : s === "cancelled" ? "neutral" : "warn") as "good" | "bad" | "neutral" | "warn";
const providerLabel = (p?: string) => (p === "openai" ? "OpenAI" : "Higgsfield");

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">{ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-live" /> : <Circle className="mt-0.5 size-4 shrink-0 text-planned" />}<span>{children}</span></li>
  );
}

export default function VisualisePage() {
  const { sessionId, roomId } = useParams<{ sessionId: string; roomId: string }>();
  const { data, err, reload } = useSession(sessionId);
  const room = data?.rooms.find((r) => r.room.id === roomId);
  const [roles, setRoles] = useState<Array<{ referenceId: string; role: ReferenceRole }>>([]);
  const [objective, setObjective] = useState("");
  const [modelId, setModelId] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");
  const [aspect, setAspect] = useState("");
  const [alternatives, setAlternatives] = useState(1);
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [refineId, setRefineId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [pool, setPool] = useState<ReferenceView[]>([]);
  const [picker, setPicker] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, JobView>>({});
  const abortRef = useRef<AbortController | null>(null);
  const { openLightbox, lightboxNode } = useLightbox();

  const briefBody = useMemo(() => ({ roles, designObjective: objective, refinementOfAssetId: refineId, modelId }), [roles, objective, refineId, modelId]);

  useEffect(() => {
    if (!data) return;
    const t = setTimeout(() => {
      api<Preview>(`/api/sessions/${sessionId}/rooms/${roomId}/brief`, { method: "POST", json: briefBody })
        .then((p) => {
          setPreview(p);
          setPreviewErr(null);
          if (!modelId) setModelId(p.model.id);
          setResolution((r) => (p.model.resolutions.includes(r) ? r : p.model.defaultResolution));
          setAspect((a) => (p.model.aspectRatios.includes(a) ? a : p.model.defaultAspectRatio));
          setExtra((e) => Object.fromEntries(Object.entries(p.model.extra).map(([k, v]) => [k, e[k] && v.values.map(String).includes(e[k]) ? e[k] : String(v.default)])));
        })
        .catch((e) => setPreviewErr(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [briefBody, data, sessionId, roomId, modelId]);

  useEffect(() => {
    if (!data) return;
    api<{ references: ReferenceView[] }>(`/api/references?offeringId=${data.session.offeringId}`).then((d) => setPool(d.references)).catch(() => undefined);
  }, [data]);

  const merged = useMemo(() => ({ ...Object.fromEntries((room?.jobs ?? []).map((job) => [job.id, { job, assets: [] as JobView["assets"] }])), ...jobs }), [room, jobs]);

  const poll = useCallback(async (id: string) => {
    try {
      const v = await api<JobView>(`/api/generation/jobs/${id}`);
      setJobs((j) => ({ ...j, [id]: v }));
    } catch {
      /* keep last known state */
    }
  }, []);
  useEffect(() => {
    const active = Object.values(merged).filter((j) => !TERMINAL.includes(j.job.status));
    const needAssets = Object.values(merged).filter((j) => j.job.status === "completed" && j.assets.length === 0 && j.job.outputAssetIds.length > 0);
    const first = setTimeout(() => needAssets.forEach((j) => poll(j.job.id)), 0);
    const t = active.length ? setInterval(() => active.forEach((j) => poll(j.job.id)), 3000) : null;
    return () => {
      clearTimeout(first);
      if (t) clearInterval(t);
    };
  }, [merged, poll]);

  if (err) return <div className="mx-auto max-w-3xl p-10"><ErrorNote error={err} /></div>;
  if (!data || !room) return <div className="p-10"><Spinner /></div>;
  const model = preview?.models.find((m) => m.id === modelId) ?? preview?.model;
  const provName = providerLabel(model?.provider);
  const provStatus = preview?.providers ? preview.providers[model?.provider ?? "higgsfield"] : preview?.provider;

  async function generate() {
    setSubmitting(true);
    setSubmitErr(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await api<{ jobs: GenerationJob[] }>(`/api/sessions/${sessionId}/rooms/${roomId}/generate`, {
        method: "POST",
        json: { ...briefBody, modelId, resolution, aspectRatio: aspect, alternatives, extra, confirmed: true },
        signal: ac.signal,
      });
      setJobs((j) => ({ ...j, ...Object.fromEntries(res.jobs.map((job) => [job.id, { job, assets: [] }])) }));
      setConfirmOpen(false);
      reload();
    } catch (e) {
      if ((e as Error).name !== "AbortError") setSubmitErr((e as Error).message);
    } finally {
      abortRef.current = null;
      setSubmitting(false);
    }
  }

  async function stopGeneration() {
    setStopping(true);
    abortRef.current?.abort();
    abortRef.current = null;
    setSubmitting(false);
    setConfirmOpen(false);
    try {
      await api(`/api/sessions/${sessionId}/previews`, { method: "DELETE" });
      await reload();
    } catch (e) {
      setSubmitErr((e as Error).message);
    } finally {
      setStopping(false);
    }
  }

  async function removeAsset(assetId: string) {
    if (!confirm("Delete this generated image?")) return;
    await api(`/api/generated-assets/${assetId}`, { method: "DELETE" });
    setJobs((prev) => {
      const next: Record<string, JobView> = {};
      for (const [k, v] of Object.entries(prev)) next[k] = { ...v, assets: v.assets.filter((a) => a.id !== assetId) };
      return next;
    });
    if (refineId === assetId) setRefineId(null);
    reload();
  }

  async function removeJob(jobId: string) {
    if (!confirm("Delete this generation job and any images it produced?")) return;
    await api(`/api/generation/jobs/${jobId}`, { method: "DELETE" });
    setJobs((prev) => {
      const next = { ...prev };
      delete next[jobId];
      return next;
    });
    reload();
  }

  const ready = preview && preview.blockers.length === 0 && provStatus?.configured && model && preview.imagesSent >= model.minReferences;
  const requests = model?.imagesPerRequest.field ? 1 : alternatives;
  const jobList = Object.values(merged).sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt));
  const allAssets = jobList.flatMap((j) => j.assets);

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/atlas/${sessionId}?room=${roomId}`} className="mb-1 inline-flex items-center gap-1 text-sm text-stone-600 hover:text-ink"><ArrowLeft className="size-4" /> Back to floor plan</Link>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl">AI visualisation · {room.room.name}</h1>
            <StageBadge state={provStatus?.configured ? "built-unverified" : "built-awaiting-config"} />
          </div>
          <p className="text-sm text-stone-600">Combine your chosen references into a new concept with OpenAI or Higgsfield. Nothing is generated until you confirm.</p>
        </div>
      </div>
      <div className="mb-5 flex items-start gap-2 rounded-2xl bg-planned-soft px-4 py-3 text-sm text-planned">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>AI output does not certify dimensions. The generated picture is an inspiration image; the measured 3D room remains the dimensional reference.</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="space-y-5">
          <section className="rounded-3xl bg-white p-5 ring-1 ring-stone-100">
            <h2 className="mb-3 font-display text-xl">Ready to generate?</h2>
            <ul className="space-y-1.5">
              <Check ok={Boolean(room.selection)}>Reference choice submitted for this room {room.selection && <span className="text-stone-600">({room.selection.snapshot.referenceCode})</span>}</Check>
              <Check ok={Boolean(room.spec?.isValid)}>
                Room measurements saved and valid · <Link className="underline" href={`/atlas/${sessionId}/rooms/${roomId}/space`}>open measured room</Link>
              </Check>
              <Check ok={Boolean(provStatus?.configured)}>
                {provName} connection {provStatus?.configured ? `configured (${provStatus.credentialVariable})` : provStatus?.problem}
              </Check>
            </ul>
            {preview?.providers && (
              <p className="mt-2 text-xs text-stone-500">
                Available providers: OpenAI ({preview.providers.openai.configured ? "configured" : "not configured"}) · Higgsfield ({preview.providers.higgsfield.configured ? "configured" : "not configured"})
              </p>
            )}
            {preview?.blockers.map((b) => <p key={b} className="mt-2 text-xs text-planned">{b}</p>)}
          </section>

          <section className="space-y-3 rounded-3xl bg-white p-5 ring-1 ring-stone-100">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl">References and their roles</h2>
              <Button size="sm" variant="secondary" onClick={() => setPicker(true)}><ImagePlus className="size-3.5" /> Add reference</Button>
            </div>
            <p className="text-xs text-stone-600">Your submitted choice is the primary reference. Add others to borrow a palette, materials, lighting or layout, for example the lighting from another project.</p>
            <div className="space-y-2">
              {preview?.brief.references.map((r, i) => {
                const v = pool.find((p) => p.id === r.referenceId) ?? (room.selection?.reference?.id === r.referenceId ? room.selection.reference : null);
                const sent = i + (refineId ? 1 : 0) < (preview?.imagesSent ?? 0);
                return (
                  <div key={`${r.referenceId}-${r.role}`} className="flex items-center gap-3 rounded-xl bg-stone-50 p-2">
                    {v && (
                      <button
                        type="button"
                        onClick={() => openLightbox({ src: v.imageUrl, title: `${r.referenceCode} · ${r.projectName}` })}
                        className="group relative h-12 w-16 shrink-0 cursor-zoom-in overflow-hidden rounded-lg"
                        aria-label={`Enlarge ${r.referenceCode}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={v.thumbUrl} alt="" className="size-full object-cover" />
                        <ZoomBadge className="right-0.5 top-0.5 p-1" />
                      </button>
                    )}
                    <div className="min-w-0 flex-1 text-xs">
                      <p className="font-medium">{r.referenceCode} · {r.projectName}</p>
                      <p className="text-stone-600">{r.role === "primary" ? "Primary design reference" : ROLES.find((x) => x.v === r.role)?.l}</p>
                    </div>
                    <Pill tone={sent ? "good" : "warn"}>{sent ? `Sent as image ${i + 1 + (refineId ? 1 : 0)}` : "Text only"}</Pill>
                    {r.role !== "primary" && (
                      <button aria-label="Remove" className="p-1 text-stone-400 hover:text-danger" onClick={() => setRoles((rs) => rs.filter((x) => !(x.referenceId === r.referenceId && x.role === r.role)))}><X className="size-4" /></button>
                    )}
                  </div>
                );
              })}
              {refineId && (
                <div className="flex items-center gap-3 rounded-xl bg-[#f4ece0] p-2 text-xs">
                  <Wand2 className="size-4" /> Refining a previous concept (sent as image 1)
                  <button className="ml-auto underline" onClick={() => setRefineId(null)}>Stop refining</button>
                </div>
              )}
            </div>
            <Field label="Design objective (optional)">
              <input className={inputCls} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="e.g. calm, premium room for client presentations" />
            </Field>
          </section>

          <section className="space-y-3 rounded-3xl bg-white p-5 ring-1 ring-stone-100">
            <h2 className="font-display text-xl">Model and settings</h2>
            {preview && (
              <>
                <Field label="AI image model" hint={model?.notes}>
                  <select className={inputCls} value={modelId ?? ""} onChange={(e) => setModelId(e.target.value)}>
                    {preview.models.map((m) => {
                      const p = m.provider ?? "higgsfield";
                      const ok = preview.providers ? preview.providers[p].configured : true;
                      return (
                        <option key={m.id} value={m.id}>
                          {m.label}{!ok ? " (not configured)" : ""}
                        </option>
                      );
                    })}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Field label="Resolution">
                    <select className={inputCls} value={resolution} onChange={(e) => setResolution(e.target.value)}>{model?.resolutions.map((r) => <option key={r}>{r}</option>)}</select>
                  </Field>
                  <Field label="Aspect ratio">
                    <select className={inputCls} value={aspect} onChange={(e) => setAspect(e.target.value)}>{model?.aspectRatios.map((r) => <option key={r}>{r}</option>)}</select>
                  </Field>
                  <Field label="Alternatives">
                    <select className={inputCls} value={alternatives} onChange={(e) => setAlternatives(Number(e.target.value))}>{[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}</select>
                  </Field>
                  {Object.entries(model?.extra ?? {}).map(([k, spec]) => (
                    <Field key={k} label={k}>
                      <select className={inputCls} value={extra[k] ?? String(spec.default)} onChange={(e) => setExtra((x) => ({ ...x, [k]: e.target.value }))}>{spec.values.map((v) => <option key={String(v)}>{String(v)}</option>)}</select>
                    </Field>
                  ))}
                </div>
                {preview.warnings.map((w) => <p key={w} className="text-xs text-planned">{w}</p>)}
              </>
            )}
            {previewErr && <ErrorNote error={previewErr} />}
            <Button size="lg" className="w-full" disabled={!ready} onClick={() => setConfirmOpen(true)}>
              <Sparkles className="size-4" /> Generate {alternatives > 1 ? `${alternatives} alternatives` : "concept"}
            </Button>
          </section>

          {preview && (
            <details className="rounded-3xl bg-white p-5 text-sm ring-1 ring-stone-100">
              <summary className="cursor-pointer font-display text-xl">Design brief sent to the model</summary>
              <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-stone-50 p-3 text-xs leading-relaxed">{preview.prompt.prompt}</pre>
              {preview.prompt.negativePrompt && model?.supportsNegativePrompt && <p className="mt-2 text-xs text-stone-600">Avoid: {preview.prompt.negativePrompt}</p>}
            </details>
          )}
        </div>

        <section className="space-y-4">
          <div className="rounded-3xl bg-white p-5 ring-1 ring-stone-100">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-xl">Generated concepts</h2>
              {(submitting || jobList.some(({ job }) => !TERMINAL.includes(job.status))) && (
                <Button size="sm" variant="danger" onClick={stopGeneration} loading={stopping}>
                  <Square className="size-3.5 fill-current" /> Stop generating AI
                </Button>
              )}
            </div>
            {allAssets.length === 0 && jobList.length === 0 && <p className="text-sm text-stone-600">Nothing generated for this room yet.</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {allAssets.map((a) => (
                <figure key={a.id} className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => openLightbox({ src: a.url, title: `${room.room.name} · AI concept` })}
                    className="group relative block w-full cursor-zoom-in overflow-hidden rounded-2xl"
                    aria-label="Enlarge generated concept"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.url} alt="Generated concept" className="w-full rounded-2xl" />
                    <ZoomBadge className="right-2.5 top-2.5" />
                  </button>
                  <figcaption className="flex items-center justify-between gap-2 text-xs">
                    <Pill tone={a.reviewStatus === "approved" ? "good" : a.reviewStatus === "rejected" ? "bad" : "neutral"}>{a.reviewStatus === "unreviewed" ? "Awaiting designer review" : a.reviewStatus.replace("_", " ")}</Pill>
                    <div className="flex items-center gap-2">
                      <button className="inline-flex items-center gap-1 text-ink hover:underline" onClick={() => setRefineId(a.id)}><Wand2 className="size-3" /> Refine this</button>
                      <button aria-label="Delete generated image" className="text-stone-400 hover:text-danger" onClick={() => removeAsset(a.id)}><Trash2 className="size-3.5" /></button>
                    </div>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
          {jobList.length > 0 && <div className="rounded-3xl bg-white p-5 ring-1 ring-stone-100">
            <h3 className="mb-2 text-sm font-medium">Job history</h3>
            <ul className="space-y-2">
              {jobList.map(({ job }) => (
                <li key={job.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-stone-50 px-3 py-2 text-xs">
                  {!TERMINAL.includes(job.status) && <Loader2 className="size-3.5 animate-spin" />}
                  <Pill tone={statusTone(job.status)}>{job.status}</Pill>
                  <span className="text-stone-600">{job.modelId}</span>
                  <span className="text-stone-400">{new Date(job.createdAt).toLocaleTimeString()}</span>
                  <span className="text-stone-400">{job.referenceInputs.length} image(s) sent</span>
                  {job.error && <span className="w-full text-danger">{job.error}</span>}
                  <div className="ml-auto flex items-center gap-2">
                    {["submitted", "queued"].includes(job.status) && (
                      <button className="inline-flex items-center gap-1 text-stone-600 hover:text-danger" onClick={async () => { const r = await api<{ job: GenerationJob; message: string }>(`/api/generation/jobs/${job.id}/cancel`, { method: "POST" }); setJobs((j) => ({ ...j, [job.id]: { assets: merged[job.id]?.assets ?? [], job: r.job } })); }}>
                        <Ban className="size-3" /> Cancel
                      </button>
                    )}
                    {job.status === "failed" && <button className="inline-flex items-center gap-1 hover:underline" onClick={() => setConfirmOpen(true)}><RefreshCw className="size-3" /> Try again</button>}
                    {TERMINAL.includes(job.status) && (
                      <button aria-label="Delete job" className="text-stone-400 hover:text-danger" onClick={() => removeJob(job.id)}><Trash2 className="size-3.5" /></button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>}
        </section>
      </div>

      <Modal open={picker} onClose={() => setPicker(false)} wide title="Add a reference">
        <div className="p-6">
          <h2 className="mb-1 font-display text-2xl">Add a reference</h2>
          <p className="mb-4 text-sm text-stone-600">Choose any approved reference available in your offering, then pick what it should contribute.</p>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {pool.map((r) => (
              <div key={r.id} className="space-y-1.5 rounded-xl bg-stone-50 p-2">
                <button
                  type="button"
                  onClick={() => openLightbox({ src: r.imageUrl, title: `${r.project.name} · ${r.roomTypeName ?? r.referenceCode}` })}
                  className="group relative block w-full cursor-zoom-in overflow-hidden rounded-lg"
                  aria-label={`Enlarge ${r.referenceCode}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.thumbUrl} alt="" className="aspect-[4/3] w-full rounded-lg object-cover" />
                  <ZoomBadge className="right-1.5 top-1.5 p-1" />
                </button>
                <p className="truncate text-xs font-medium">{r.project.name} · {r.roomTypeName}</p>
                <select className={cx(inputCls, "py-1 text-xs")} defaultValue="" onChange={(e) => { if (!e.target.value) return; setRoles((rs) => [...rs, { referenceId: r.id, role: e.target.value as ReferenceRole }]); setPicker(false); }}>
                  <option value="">Use for…</option>
                  {ROLES.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm generation">
        <div className="space-y-4 p-6">
          <h2 className="font-display text-2xl">Start AI generation?</h2>
          <p className="text-sm text-stone-600">
            This sends {requests} request{requests > 1 ? "s" : ""} to {provName} ({model?.label}) for {alternatives} image{alternatives > 1 ? "s" : ""} with {preview?.imagesSent ?? 0} reference image(s). Image generation may incur charges on your {provName} account.
          </p>
          <ErrorNote error={submitErr} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => (submitting ? stopGeneration() : setConfirmOpen(false))}>{submitting ? "Stop generating AI" : "Cancel"}</Button>
            <Button onClick={generate} loading={submitting}><Sparkles className="size-4" /> Yes, generate</Button>
          </div>
        </div>
      </Modal>
      {lightboxNode}
    </div>
  );
}
