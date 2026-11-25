"use client";
import { Check, Columns2, FileText, Maximize2, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReferenceView } from "@/modules/intelligence/library";
import { api, deleteResource } from "./api";
import { Button, cx, Empty, ErrorNote, inputCls, Modal, Pill, Spinner, Swatches } from "./ui";

export type { ReferenceView };

export type Config = {
  roomTypes: Array<{ id: string; name: string }>;
  offerings: Array<{ id: string; name: string; description: string; rank: number; isDemo: boolean }>;
  properties: Array<{ id: string; name: string; city: string; isDemo: boolean }>;
  floorPlans: Array<import("@/modules/core/schemas").FloorPlan>;
  directions: Array<{ id: string; name: string; status: string }>;
  materials: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; propertyName: string; city: string; isDemo: boolean }>;
  isStaff?: boolean;
  aiVisionConfigured?: boolean;
};

export const sourceLabel = (r: ReferenceView) =>
  r.source.page ? `${r.source.kind === "pptx-slide" ? "Slide" : "Page"} ${r.source.page} · ${r.source.filename}` : r.source.filename;

export function ReferenceCard({ r, selected, onOpen, onToggleCompare, comparing, offeringId }: { r: ReferenceView; selected?: boolean; onOpen: () => void; onToggleCompare?: () => void; comparing?: boolean; offeringId?: string }) {
  const elig = offeringId ? r.eligibility.find((e) => e.offeringId === offeringId) : null;
  return (
    <article className={cx("group overflow-hidden rounded-2xl bg-white shadow-sm ring-1 transition hover:shadow-md", selected ? "ring-2 ring-bronze" : "ring-stone-100")}>
      <button onClick={onOpen} className="relative block aspect-[4/3] w-full overflow-hidden bg-stone-50" aria-label={`Open ${r.referenceCode}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={r.thumbUrl} alt={`${r.roomTypeName ?? "Reference"} from ${r.project.name}`} loading="lazy" className="size-full object-cover transition duration-500 group-hover:scale-[1.03]" />
        <span className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 opacity-0 shadow transition group-hover:opacity-100">
          <Maximize2 className="size-3.5" />
        </span>
        {selected && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-bronze px-2 py-1 text-[11px] font-medium text-white">
            <Check className="size-3" /> Selected
          </span>
        )}
        {r.isDemo && <span className="absolute bottom-2 left-2"><Pill tone="demo">DEMO</Pill></span>}
      </button>
      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{r.roomTypeName ?? <span className="text-stone-400">Room type not set</span>}</p>
            <p className="truncate text-xs text-stone-600">
              {r.project.name}
              {r.project.propertyName && ` · ${r.project.propertyName}`}
            </p>
          </div>
          <Swatches palette={r.palette} />
        </div>
        <div className="flex flex-wrap gap-1">
          {r.directionName && <Pill>{r.directionName}</Pill>}
          {r.materials.slice(0, 3).map((m) => (
            <Pill key={m}>{m}</Pill>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-stone-400">
          <span className="truncate" title={sourceLabel(r)}>
            {r.referenceCode} · {r.source.page ? `p.${r.source.page}` : "image"}
          </span>
          {elig && <Pill tone={elig.eligible ? "good" : "warn"}>{elig.eligible ? "Eligible" : "Not in offering"}</Pill>}
          {onToggleCompare && (
            <button onClick={onToggleCompare} className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5", comparing ? "bg-ink text-paper" : "hover:bg-stone-100")}>
              <Columns2 className="size-3" /> Compare
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 border-t border-stone-100 py-2 text-sm">
      <dt className="text-stone-600">{label}</dt>
      <dd>{children || <span className="text-stone-400">Not recorded</span>}</dd>
    </div>
  );
}

const join = (xs: Array<string | null | undefined>) => xs.filter(Boolean).join(", ");

export function ReferenceDetail({ id, onClose, onSelect, selectedId, offeringId, isStaff, onDeleted }: { id: string | null; onClose: () => void; onSelect?: (r: ReferenceView) => void; selectedId?: string | null; offeringId?: string; isStaff?: boolean; onDeleted?: () => void }) {
  type Detail = { reference: ReferenceView; similar: Array<{ score: number; basis: string[]; reference: ReferenceView }> };
  // The parent remounts this component (key) when a different image is opened; `nav` follows "similar" clicks.
  const [nav, setCurrent] = useState<string | null>(null);
  const current = nav ?? id;
  const [loaded, setLoaded] = useState<{ id: string; data: Detail | null; err: string | null } | null>(null);
  const [delErr, setDelErr] = useState<string | null>(null);
  useEffect(() => {
    if (!current) return;
    let live = true;
    api<Detail>(`/api/references/${current}`)
      .then((d) => live && setLoaded({ id: current, data: d, err: null }))
      .catch((e) => live && setLoaded({ id: current, data: null, err: e.message }));
    return () => {
      live = false;
    };
  }, [current]);
  const fresh = loaded?.id === current ? loaded : null;
  const data = fresh?.data ?? null;
  const err = fresh?.err ?? null;
  const r = data?.reference;
  const m = r?.metadata;
  const elig = r && offeringId ? r.eligibility.find((e) => e.offeringId === offeringId) : null;
  return (
    <Modal open={Boolean(id)} onClose={onClose} wide title="Reference preview">
      {err && <p className="p-8 text-danger">{err}</p>}
      {!r && !err && <div className="p-10"><Spinner /></div>}
      {r && m && (
        <div className="grid lg:grid-cols-[1.6fr_1fr]">
          <div className="bg-ink">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={r.imageUrl} alt={r.referenceCode} className="mx-auto max-h-[80vh] w-full object-contain" />
          </div>
          <div className="space-y-4 p-6">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-xs uppercase tracking-[0.18em] text-stone-600">{r.referenceCode}</p>
                {r.isDemo && <Pill tone="demo">DEMO, NOT A REAL PROJECT</Pill>}
              </div>
              <h2 className="font-display text-2xl">{r.roomTypeName ?? "Reference"}</h2>
              <p className="text-sm text-stone-600">
                {r.project.name}
                {r.project.propertyName && ` · ${r.project.propertyName}`}
                {r.project.city && ` · ${r.project.city}`}
              </p>
            </div>
            {onSelect && (
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => onSelect(r)} disabled={Boolean(elig && !elig.eligible)}>
                  <Check className="size-4" /> {selectedId === r.id ? "Selected" : "Select this image"}
                </Button>
                {elig && !elig.eligible && <span className="text-xs text-planned">{elig.reasons.join(" ")}</span>}
              </div>
            )}
            {isStaff && !onSelect && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    setDelErr(null);
                    try {
                      if (await deleteResource(`/api/references/${r.id}`, `Permanently delete ${r.referenceCode}?`)) {
                        onDeleted?.();
                        onClose();
                      }
                    } catch (e) {
                      setDelErr((e as Error).message);
                    }
                  }}
                >
                  <Trash2 className="size-3.5" /> Delete reference
                </Button>
                <ErrorNote error={delErr} />
              </div>
            )}
            <div className="flex items-center gap-3">
              <Swatches palette={m.colors.palette} size="md" />
              <span className="text-xs text-stone-600">{m.colors.palette.map((p) => p.hex).join(" ")}</span>
            </div>
            <dl>
              <MetaRow label="Source">
                <span className="inline-flex items-center gap-1"><FileText className="size-3.5" /> {sourceLabel(r)}</span>
              </MetaRow>
              <MetaRow label="Design language">{join([m.designLanguage, r.directionName && `Direction: ${r.directionName}`])}</MetaRow>
              <MetaRow label="Materials">{join(r.materials)}</MetaRow>
              <MetaRow label="Lighting">{join([m.lighting.natural, m.lighting.artificial, m.lighting.ambient, m.lighting.accent, m.lighting.temperatureK ? `${m.lighting.temperatureK} K` : null])}</MetaRow>
              <MetaRow label="Furniture">{join([...m.furniture.types, m.furniture.arrangement])}</MetaRow>
              <MetaRow label="Distinctive">{join([...m.furniture.distinctiveElements, ...m.visualCharacteristics])}</MetaRow>
              <MetaRow label="Dimensions">
                {m.dimensions.length && m.dimensions.width ? `${m.dimensions.length} x ${m.dimensions.width}${m.dimensions.height ? ` x ${m.dimensions.height}` : ""} ${m.dimensions.unit} (${m.dimensions.source})` : "Not supplied (never estimated from photos)"}
              </MetaRow>
              <MetaRow label="Offerings">
                <div className="flex flex-wrap gap-1">
                  {r.eligibility.map((e) => (
                    <Pill key={e.offeringId} tone={e.eligible ? "good" : "neutral"}>
                      {e.offeringName}
                    </Pill>
                  ))}
                </div>
              </MetaRow>
            </dl>
            <p className="text-[11px] text-stone-400">Colours are sampled from the image pixels. Other details are recorded by the review team{r.analysis.status === "completed" ? " with AI assistance" : ""}.</p>
            {data!.similar.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-stone-600">Similar across the portfolio</p>
                <div className="grid grid-cols-3 gap-2">
                  {data!.similar.slice(0, 6).map((s) => (
                    <button key={s.reference.id} onClick={() => setCurrent(s.reference.id)} className="text-left" title={s.basis.join("\n")}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.reference.thumbUrl} alt="" className="aspect-[4/3] w-full rounded-lg object-cover" />
                      <span className="mt-1 block truncate text-[11px] text-stone-600">{s.reference.project.name}</span>
                      <span className="block text-[10px] text-stone-400">match {Math.round(s.score * 100)}% (attributes)</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export function CompareView({ items, onClose, onRemove }: { items: ReferenceView[]; onClose: () => void; onRemove: (id: string) => void }) {
  return (
    <Modal open={items.length > 0} onClose={onClose} wide title="Compare references">
      <div className="p-6">
        <h2 className="mb-4 font-display text-2xl">Compare</h2>
        <div className={cx("grid gap-4", items.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
          {items.map((r) => (
            <div key={r.id} className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.imageUrl} alt={r.referenceCode} className="aspect-[4/3] w-full rounded-xl object-cover" />
              <div className="flex items-center justify-between">
                <p className="font-medium">{r.project.name}</p>
                <button onClick={() => onRemove(r.id)} className="text-xs text-stone-600 hover:underline">Remove</button>
              </div>
              <p className="text-xs text-stone-600">{r.roomTypeName} · {r.referenceCode} · {sourceLabel(r)}</p>
              <Swatches palette={r.palette} size="md" />
              <p className="text-sm"><span className="text-stone-600">Materials:</span> {r.materials.join(", ") || "not recorded"}</p>
              <p className="text-sm"><span className="text-stone-600">Lighting:</span> {join([r.metadata.lighting.artificial, r.metadata.lighting.ambient, r.metadata.lighting.natural]) || "not recorded"}</p>
              <p className="text-sm"><span className="text-stone-600">Style:</span> {r.metadata.designLanguage ?? "not recorded"}</p>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export type GalleryProps = {
  config: Config;
  fixed?: { roomTypeId?: string; offeringId?: string };
  selectedId?: string | null;
  onSelect?: (r: ReferenceView) => void;
  compact?: boolean;
};

/** Filterable reference gallery used by the library page and the room picker. */
export function ReferenceGallery({ config, fixed, selectedId, onSelect, compact }: GalleryProps) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [refs, setRefs] = useState<ReferenceView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [compare, setCompare] = useState<ReferenceView[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [showFilters, setShowFilters] = useState(!compact);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, ...(fixed ?? {}) })) if (v) p.set(k, v);
    return p.toString();
  }, [filters, fixed]);

  const load = useCallback(() => {
    setErr(null);
    api<{ references: ReferenceView[] }>(`/api/references?${query}`)
      .then((d) => setRefs(d.references))
      .catch((e) => setErr(e.message));
  }, [query]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const set = (k: string, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const cities = Array.from(new Set(config.projects.map((p) => p.city).filter(Boolean)));
  const propertiesList = Array.from(new Set(config.projects.map((p) => p.propertyName).filter(Boolean)));
  const toggleCompare = (r: ReferenceView) => setCompare((c) => (c.some((x) => x.id === r.id) ? c.filter((x) => x.id !== r.id) : c.length >= 3 ? c : [...c, r]));

  const sel = (k: string, label: string, opts: Array<{ v: string; l: string }>) => (
    <select aria-label={label} className={inputCls} value={filters[k] ?? ""} onChange={(e) => set(k, e.target.value)}>
      <option value="">{label}</option>
      {opts.map((o) => (
        <option key={o.v} value={o.v}>{o.l}</option>
      ))}
    </select>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
          <input className={cx(inputCls, "pl-9")} placeholder="Search materials, styles, projects, keywords" value={filters.q ?? ""} onChange={(e) => set("q", e.target.value)} />
        </div>
        <Button variant="secondary" onClick={() => setShowFilters((s) => !s)}>
          <SlidersHorizontal className="size-4" /> Filters
        </Button>
        {compare.length > 0 && (
          <Button variant="secondary" onClick={() => setShowCompare(true)}>
            <Columns2 className="size-4" /> Compare ({compare.length})
          </Button>
        )}
      </div>
      {showFilters && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-5 fade-in">
          {!fixed?.roomTypeId && sel("roomTypeId", "All room types", config.roomTypes.map((r) => ({ v: r.id, l: r.name })))}
          {!fixed?.offeringId && sel("offeringId", "Any offering", config.offerings.map((o) => ({ v: o.id, l: o.name })))}
          {sel("projectId", "All projects", config.projects.map((p) => ({ v: p.id, l: p.name })))}
          {propertiesList.length > 0 && sel("propertyName", "All properties", propertiesList.map((p) => ({ v: p, l: p })))}
          {cities.length > 0 && sel("city", "All cities", cities.map((c) => ({ v: c, l: c })))}
          {config.directions.length > 0 && sel("directionId", "All design directions", config.directions.map((d) => ({ v: d.id, l: d.name })))}
          <input className={inputCls} placeholder="Material (e.g. Glass)" value={filters.material ?? ""} onChange={(e) => set("material", e.target.value)} />
          <input className={inputCls} placeholder="Characteristic / tag" value={filters.characteristic ?? ""} onChange={(e) => set("characteristic", e.target.value)} />
          <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-2">
            <input type="color" aria-label="Colour" className="h-8 w-8 cursor-pointer border-0 bg-transparent" value={filters.colour || "#a39a8b"} onChange={(e) => set("colour", e.target.value)} />
            <span className="text-xs text-stone-600">{filters.colour ? `Near ${filters.colour}` : "Colour"}</span>
            {filters.colour && <button className="ml-auto text-xs text-stone-600" onClick={() => set("colour", "")}>Clear</button>}
          </div>
        </div>
      )}
      {err && <p className="text-sm text-danger">{err}</p>}
      {!refs && !err && <Spinner label="Loading references" />}
      {refs && refs.length === 0 && (
        <Empty title="No matching references yet">
          {fixed?.roomTypeId ? "No approved references for this room type are available under the chosen offering. Your team can add and approve them in Studio." : "Try removing a filter, or upload and approve project presentations in Studio."}
        </Empty>
      )}
      {refs && refs.length > 0 && (
        <>
          <p className="text-xs text-stone-600">{refs.length} reference{refs.length === 1 ? "" : "s"}</p>
          <div className={cx("grid gap-4", compact ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4")}>
            {refs.map((r) => (
              <ReferenceCard key={r.id} r={r} selected={selectedId === r.id} onOpen={() => setOpenId(r.id)} onToggleCompare={() => toggleCompare(r)} comparing={compare.some((c) => c.id === r.id)} offeringId={fixed?.offeringId ?? filters.offeringId} />
            ))}
          </div>
        </>
      )}
      <ReferenceDetail
        key={openId ?? "closed"}
        id={openId}
        onClose={() => setOpenId(null)}
        offeringId={fixed?.offeringId ?? filters.offeringId}
        selectedId={selectedId}
        isStaff={config.isStaff}
        onDeleted={load}
        onSelect={
          onSelect
            ? (r) => {
                onSelect(r);
                setOpenId(null);
              }
            : undefined
        }
      />
      {showCompare && <CompareView items={compare} onClose={() => setShowCompare(false)} onRemove={(id) => setCompare((c) => c.filter((x) => x.id !== id))} />}
    </div>
  );
}

export function useConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reload = useCallback(() => {
    api<Config>("/api/config").then(setConfig).catch((e) => setErr(e.message));
  }, []);
  useEffect(reload, [reload]);
  return { config, err, reload };
}
