"use client";
import { ArrowLeft, Download, FileUp, Map as MapIcon, Sparkles, Trash2, UploadCloud } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, deleteResource } from "@/components/api";
import { useLightbox, ZoomBadge } from "@/components/lightbox";
import { Button, cx, ErrorNote, Pill, Spinner } from "@/components/ui";
import type { Project, ReferenceAsset, SourceDocument } from "@/modules/core/schemas";

type RefLite = {
  id: string;
  referenceCode: string;
  documentId: string;
  sourceFilename: string;
  sourceKind: string;
  sourcePage: number | null;
  thumbUrl: string;
  imageUrl: string;
  width: number;
  height: number;
  reviewStatus: string;
  roomTypeName: string | null;
  analysis?: ReferenceAsset["analysis"];
};
type Detail = {
  project: Project;
  aiConfigured?: boolean;
  documents: SourceDocument[];
  references: RefLite[];
  counts: { references: number; approved: number; pending: number };
};
type UploadResult = {
  filename: string;
  ok: boolean;
  status: string;
  alreadyProcessed?: boolean;
  createdReferences?: number;
  duplicateImages?: number;
  errors?: Array<{ page: number | null; message: string }>;
  error?: string;
  aiScan?: { scanned: boolean; analysis?: { completed: number; failed: number }; pdfScan?: { floorPlanId?: string | null; layoutLegend?: unknown[] } | null } | null;
  aiScanError?: string | null;
};

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanningDocId, setScanningDocId] = useState<string | null>(null);
  const [analysingRefId, setAnalysingRefId] = useState<string | null>(null);
  const [autoScan, setAutoScan] = useState(true);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { openLightbox, lightboxNode } = useLightbox();
  const load = useCallback(() => api<Detail>(`/api/projects/${id}`).then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => {
    load();
  }, [load]);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.set("autoScan", autoScan ? "true" : "false");
      list.forEach((f) => fd.append("files", f));
      const r = await api<{ results: UploadResult[] }>(`/api/projects/${id}/upload`, { method: "POST", body: fd });
      setResults(r.results);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function scanDoc(docId: string) {
    setScanningDocId(docId);
    setErr(null);
    try {
      await api(`/api/documents/${docId}/scan`, { method: "POST", json: { createFloorPlan: true, analyseImages: true, onlyUnanalysed: false } });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setScanningDocId(null);
    }
  }

  async function analyseRef(refId: string) {
    setAnalysingRefId(refId);
    setErr(null);
    try {
      await api(`/api/references/${refId}/analyse`, { method: "POST" });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAnalysingRefId(null);
    }
  }

  async function removeProject() {
    if (!d) return;
    setErr(null);
    try {
      if (await deleteResource(`/api/projects/${d.project.id}`, `Delete project "${d.project.name}", all ${d.documents.length} source document(s), and all ${d.counts.references} extracted image(s)?`)) {
        router.push("/studio/projects");
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function removeDocument(doc: SourceDocument, imageCount: number) {
    setErr(null);
    try {
      if (await deleteResource(`/api/documents/${doc.id}`, `Delete "${doc.filename}" and its ${imageCount} extracted image(s)?`)) {
        await load();
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function removeReference(ref: RefLite) {
    setErr(null);
    try {
      if (await deleteResource(`/api/references/${ref.id}`, `Delete ${ref.referenceCode}${ref.sourcePage ? ` (page ${ref.sourcePage})` : ""} permanently?`)) {
        await load();
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (!d) return err ? <ErrorNote error={err} /> : <Spinner />;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/studio/projects" className="mb-1 inline-flex items-center gap-1 text-sm text-stone-600 hover:text-ink"><ArrowLeft className="size-4" /> All projects</Link>
          <h1 className="font-display text-3xl">{d.project.name} {d.project.isDemo && <Pill tone="demo">DEMO</Pill>}</h1>
          <p className="text-sm text-stone-600">{[d.project.clientName, d.project.propertyName, d.project.city, d.project.category].filter(Boolean).join(" · ")}</p>
          <div className="mt-2 flex gap-2 text-xs">
            <Pill>{d.counts.references} references</Pill>
            <Pill tone="good">{d.counts.approved} approved</Pill>
            <Pill tone="warn">{d.counts.pending} awaiting review</Pill>
            <Link className="underline" href={`/studio/review?projectId=${d.project.id}`}>Review this project</Link>
          </div>
        </div>
        <Button variant="danger" size="sm" onClick={removeProject}><Trash2 className="size-3.5" /> Delete project</Button>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
        className={cx("flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed bg-white px-6 py-10 text-center transition", drag ? "border-bronze bg-[#f4ece0]" : "border-stone-200")}
      >
        <UploadCloud className="size-8 text-bronze" />
        <p className="font-medium">Drop PDF, PPTX, JPG, PNG or WEBP files here</p>
        <p className="max-w-md text-xs text-stone-600">Images and text are extracted with their page or slide number. Re-uploading the same file does not create duplicates. Old .ppt files must be saved as .pptx first.</p>
        {d.aiConfigured && (
          <label className="inline-flex items-center gap-2 text-xs text-stone-700">
            <input type="checkbox" checked={autoScan} onChange={(e) => setAutoScan(e.target.checked)} />
            Scan uploaded PDFs with Claude AI (extract 2D floor plan, mood board, legend &amp; tag room renders)
          </label>
        )}
        <input ref={input} type="file" multiple hidden accept=".pdf,.pptx,.jpg,.jpeg,.png,.webp" onChange={(e) => e.target.files && upload(e.target.files)} />
        <Button onClick={() => input.current?.click()} loading={busy}><FileUp className="size-4" /> {busy ? "Processing…" : "Choose files"}</Button>
      </div>
      <ErrorNote error={err} />
      {results.length > 0 && (
        <div className="space-y-2 rounded-3xl bg-white p-4 ring-1 ring-stone-100">
          <p className="text-sm font-medium">Upload results</p>
          {results.map((r) => (
            <div key={r.filename} className="rounded-xl bg-stone-50 p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <b>{r.filename}</b>
                <Pill tone={r.ok ? (r.status === "processed" ? "good" : "warn") : "bad"}>{r.status}</Pill>
                {r.alreadyProcessed && <Pill>Already processed, no duplicates created</Pill>}
                {r.createdReferences != null && <span className="text-xs text-stone-600">{r.createdReferences} new references, {r.duplicateImages} duplicate images skipped</span>}
                {r.aiScan?.scanned && (
                  <Pill tone="good">
                    AI scan: {r.aiScan.analysis?.completed ?? 0} tagged
                    {r.aiScan.pdfScan?.floorPlanId ? " · 2D floor plan extracted" : ""}
                  </Pill>
                )}
              </p>
              {r.error && <p className="text-xs text-danger">{r.error}</p>}
              {r.aiScanError && <p className="text-xs text-planned">AI scan warning: {r.aiScanError}</p>}
              {r.errors?.slice(0, 5).map((e, i) => <p key={i} className="text-xs text-planned">{e.page ? `Page ${e.page}: ` : ""}{e.message}</p>)}
            </div>
          ))}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-xl">Source documents</h2>
        {d.documents.length === 0 && <p className="text-sm text-stone-600">No documents uploaded yet.</p>}
        {d.documents.map((doc) => {
          const docRefs = d.references.filter((r) => r.documentId === doc.id);
          const scan = doc.pdfScan;
          return (
            <details key={doc.id} className="rounded-2xl bg-white p-4 ring-1 ring-stone-100">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                <b>{doc.filename}</b>
                <Pill>{doc.kind.toUpperCase()}</Pill>
                <Pill tone={doc.status === "processed" ? "good" : doc.status === "failed" ? "bad" : "warn"}>{doc.status}</Pill>
                {scan && <Pill tone="good">AI scanned</Pill>}
                <span className="text-xs text-stone-600">{doc.pageCount != null ? `${doc.pageCount} pages/slides · ` : ""}{docRefs.length} images · {(doc.sizeBytes / 1048576).toFixed(1)} MB · {new Date(doc.uploadedAt).toLocaleString()}</span>
                <span className="ml-auto flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  {d.aiConfigured && (
                    <Button size="sm" variant="secondary" loading={scanningDocId === doc.id} onClick={() => scanDoc(doc.id)}>
                      <Sparkles className="size-3" /> {scan ? "Re-scan with AI" : "Scan with AI"}
                    </Button>
                  )}
                  <a href={`/api/assets/source-documents/${doc.blobKey}`} className="inline-flex items-center gap-1 text-xs hover:underline"><Download className="size-3" /> Original</a>
                  <button className="inline-flex items-center gap-1 text-xs text-danger hover:underline" onClick={() => removeDocument(doc, docRefs.length)}><Trash2 className="size-3" /> Delete file</button>
                </span>
              </summary>
              <div className="mt-3 space-y-4">
                {scan && (
                  <div className="space-y-3 rounded-2xl bg-stone-50 p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-ink">
                        AI PDF Scan ({scan.model})
                        {scan.projectDetails.location && ` · ${scan.projectDetails.location}`}
                        {scan.projectDetails.date && ` · ${scan.projectDetails.date}`}
                      </p>
                      {scan.floorPlanId && (
                        <Link href={`/studio/plans?planId=${scan.floorPlanId}`} className="inline-flex items-center gap-1 rounded-full bg-live-soft px-3 py-1 font-medium text-live hover:underline">
                          <MapIcon className="size-3.5" /> Open extracted 2D floor plan
                        </Link>
                      )}
                    </div>
                    {scan.floorPlanError && <p className="text-planned">Floor plan scan note: {scan.floorPlanError}</p>}
                    {scan.moodBoard && (
                      <div className="space-y-1">
                        <p className="font-medium text-stone-700">Mood Board {scan.moodBoard.page ? `(page ${scan.moodBoard.page})` : ""}</p>
                        {scan.moodBoard.styleSummary && <p className="text-stone-600">{scan.moodBoard.styleSummary}</p>}
                        {scan.moodBoard.materialPalette.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {scan.moodBoard.materialPalette.map((m) => <Pill key={m}>{m}</Pill>)}
                          </div>
                        )}
                      </div>
                    )}
                    {scan.layoutLegend.length > 0 && (
                      <div>
                        <p className="mb-1 font-medium text-stone-700">Layout Legend ({scan.layoutLegend.length} space types)</p>
                        <div className="flex flex-wrap gap-1.5">
                          {scan.layoutLegend.map((row, idx) => (
                            <span key={`${row.name}-${idx}`} className="rounded-lg bg-white px-2 py-1 ring-1 ring-stone-200">
                              {row.name}{row.capacity ? ` (${row.capacity})` : ""}{row.count != null ? ` × ${row.count}` : ""}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-medium text-stone-600">Extraction notes</p>
                    {doc.errors.length === 0 ? <p className="text-xs text-live">No problems.</p> : doc.errors.map((e, i) => <p key={i} className="text-xs text-planned">{e.page ? `Page ${e.page}: ` : ""}{e.message}</p>)}
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-stone-600">Extracted text</p>
                    <div className="max-h-48 space-y-1 overflow-auto text-xs text-stone-600">
                      {doc.pageText.length === 0 ? "No text found." : doc.pageText.map((t) => <p key={t.page}><b>{t.page}.</b> {t.text.slice(0, 300)}</p>)}
                    </div>
                  </div>
                </div>
                {docRefs.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium text-stone-600">Extracted images ({docRefs.length})</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                      {docRefs.map((ref) => (
                        <div key={ref.id} className="group relative overflow-hidden rounded-xl bg-stone-50 ring-1 ring-stone-100">
                          <button
                            type="button"
                            onClick={() => openLightbox({ src: ref.imageUrl, title: ref.referenceCode, subtitle: ref.roomTypeName ?? d.project.name })}
                            className="relative block w-full cursor-zoom-in"
                            aria-label={`Enlarge ${ref.referenceCode}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={ref.thumbUrl} alt={ref.referenceCode} className="block h-24 w-full object-cover" />
                            <ZoomBadge className="left-1.5 top-1.5 p-1" />
                          </button>
                          <button
                            aria-label={`Delete ${ref.referenceCode}`}
                            onClick={() => removeReference(ref)}
                            className="absolute right-1.5 top-1.5 rounded-full bg-white/90 p-1 text-stone-600 shadow hover:text-danger"
                          >
                            <Trash2 className="size-3" />
                          </button>
                          <div className="space-y-0.5 px-2 py-1 text-[11px]">
                            <p className="truncate font-medium">{ref.referenceCode}{ref.sourcePage ? ` · p.${ref.sourcePage}` : ""}</p>
                            <p className="truncate text-stone-500">
                              {ref.analysis?.imageRole && ref.analysis.imageRole !== "design_render"
                                ? `AI: ${ref.analysis.imageRole.replace("_", " ")}`
                                : (ref.roomTypeName ?? ref.reviewStatus)}
                            </p>
                            {d.aiConfigured && ref.analysis?.status !== "completed" && (
                              <button
                                disabled={analysingRefId === ref.id}
                                onClick={() => analyseRef(ref.id)}
                                className="inline-flex items-center gap-1 text-[10px] text-bronze hover:underline disabled:opacity-50"
                              >
                                <Sparkles className="size-2.5" /> {analysingRefId === ref.id ? "Analysing…" : "Analyse"}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </section>
      {lightboxNode}
    </div>
  );
}
