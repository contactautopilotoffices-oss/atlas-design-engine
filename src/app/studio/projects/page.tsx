"use client";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, deleteResource } from "@/components/api";
import { Button, Empty, ErrorNote, Field, inputCls, Pill, Spinner } from "@/components/ui";

type Row = { id: string; name: string; clientName: string; propertyName: string; city: string; category: string; isDemo: boolean; documents: Array<{ id: string; filename: string; status: string }>; lastUploadAt: string | null; processingStatus: string; extractedImages: number; reviewedReferences: number };

export default function ProjectsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", clientName: "", propertyName: "", city: "", category: "" });
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => api<{ projects: Row[] }>("/api/projects").then((d) => setRows(d.projects)).catch((e) => setErr(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    setCreating(true);
    setErr(null);
    try {
      await api("/api/projects", { method: "POST", json: form });
      setForm({ name: "", clientName: "", propertyName: "", city: "", category: "" });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function removeProject(p: Row) {
    setErr(null);
    try {
      if (await deleteResource(`/api/projects/${p.id}`, `Delete project "${p.name}" and all ${p.documents.length} document(s) / ${p.extractedImages} extracted image(s)?`)) {
        await load();
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Projects and uploads</h1>
        <p className="text-sm text-stone-600">Create a project, then upload its presentations (PDF, PPTX) and images. Several documents can belong to one project.</p>
      </div>
      <section className="rounded-3xl bg-white p-5 ring-1 ring-stone-100">
        <h2 className="mb-3 font-medium">New project</h2>
        <div className="grid gap-2 sm:grid-cols-5">
          {(["name", "clientName", "propertyName", "city", "category"] as const).map((k) => (
            <Field key={k} label={{ name: "Project name *", clientName: "Client", propertyName: "Property", city: "City", category: "Category" }[k]}>
              <input className={inputCls} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} placeholder={k === "category" ? "e.g. Corporate office" : ""} />
            </Field>
          ))}
        </div>
        <div className="mt-3"><Button onClick={create} loading={creating} disabled={!form.name.trim()}><Plus className="size-4" /> Create project</Button></div>
      </section>
      <ErrorNote error={err} />
      {!rows && !err && <Spinner />}
      {rows && rows.length === 0 && <Empty title="No projects yet">Create your first project above, or load clearly labelled demo content in Administration.</Empty>}
      {rows && rows.length > 0 && (
        <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-stone-100">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs text-stone-600">
              <tr>
                <th className="px-4 py-2 font-medium">Project</th>
                <th className="px-4 py-2 font-medium">Property · City</th>
                <th className="px-4 py-2 font-medium">Source documents</th>
                <th className="px-4 py-2 font-medium">Last upload</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium text-right">Images</th>
                <th className="px-4 py-2 font-medium text-right">Reviewed</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-stone-100">
                  <td className="px-4 py-3">
                    <p className="font-medium">{p.name} {p.isDemo && <Pill tone="demo">DEMO</Pill>}</p>
                    <p className="text-xs text-stone-600">{[p.clientName, p.category].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td className="px-4 py-3 text-stone-600">{[p.propertyName, p.city].filter(Boolean).join(" · ") || "-"}</td>
                  <td className="max-w-[220px] px-4 py-3 text-xs text-stone-600"><span className="line-clamp-2">{p.documents.map((d) => d.filename).join(", ") || "-"}</span></td>
                  <td className="px-4 py-3 text-xs text-stone-600">{p.lastUploadAt ? new Date(p.lastUploadAt).toLocaleDateString() : "-"}</td>
                  <td className="px-4 py-3"><Pill tone={p.processingStatus === "processed" ? "good" : p.processingStatus === "no documents" ? "neutral" : p.processingStatus === "has failures" ? "bad" : "warn"}>{p.processingStatus}</Pill></td>
                  <td className="px-4 py-3 text-right tabular-nums">{p.extractedImages}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{p.reviewedReferences}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-3">
                      <Link href={`/studio/projects/${p.id}`} className="inline-flex items-center gap-1 text-xs hover:underline">Open <ArrowRight className="size-3" /></Link>
                      <button aria-label={`Delete ${p.name}`} className="text-stone-400 hover:text-danger" onClick={() => removeProject(p)}><Trash2 className="size-4" /></button>
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
