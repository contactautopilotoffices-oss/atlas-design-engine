"use client";
import { ArrowRight, Clock, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/components/api";
import { useConfig } from "@/components/references";
import { Button, ErrorNote, Field, inputCls, Pill, Spinner, StageBadge } from "@/components/ui";

type Session = { id: string; propertyId: string; offeringId: string; clientName: string; createdAt: string };

const FLOW = ["Open the property", "Open the 2D floor plan", "Click a room", "Browse matching references", "Enlarge and select an image", "Submit choice", "Preview selected rooms"];

export default function Workspace() {
  const router = useRouter();
  const { config, err } = useConfig();
  const [propertyChoice, setPropertyId] = useState("");
  const [floorPlanChoice, setFloorPlanId] = useState("");
  const [offeringChoice, setOfferingId] = useState("");
  const [clientName, setClientName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<Session[]>([]);

  useEffect(() => {
    api<{ sessions: Session[] }>("/api/sessions").then((d) => setMine(d.sessions)).catch(() => undefined);
  }, []);
  // Defaults are derived rather than copied into state, so nothing needs syncing.
  // Only published plans can be opened. Real properties are listed before demo ones.
  const properties = useMemo(
    () => (config?.properties ?? []).filter((p) => config?.floorPlans.some((f) => f.propertyId === p.id && f.status !== "draft")).sort((a, b) => Number(a.isDemo) - Number(b.isDemo)),
    [config],
  );
  const propertyId = properties.some((p) => p.id === propertyChoice) ? propertyChoice : (properties[0]?.id ?? "");
  const offeringId = offeringChoice || config?.offerings[0]?.id || "";
  const plans = useMemo(() => config?.floorPlans.filter((f) => f.propertyId === propertyId && f.status !== "draft") ?? [], [config, propertyId]);
  const floorPlanId = plans.some((p) => p.id === floorPlanChoice) ? floorPlanChoice : (plans[0]?.id ?? "");
  const property = config?.properties.find((p) => p.id === propertyId);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const { session } = await api<{ session: Session }>("/api/sessions", { method: "POST", json: { propertyId, floorPlanId, offeringId, clientName } });
      router.push(`/atlas/${session.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
      <section className="grid gap-10 lg:grid-cols-[1.25fr_1fr] lg:items-center">
        <div className="space-y-5">
          <p className="text-xs uppercase tracking-[0.24em] text-bronze">From project references to client choices</p>
          <h1 className="font-display text-4xl leading-[1.05] sm:text-6xl">Design from what we have already built.</h1>
          <p className="max-w-xl text-lg text-stone-600">Walk through the floor plan, choose rooms, and pick from our real project references. Your choices are saved as you submit them.</p>
          <ol className="flex flex-wrap gap-2 pt-2">
            {FLOW.map((s, i) => (
              <li key={s} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs text-ink-soft ring-1 ring-stone-100">
                <span className="text-live">{i + 1}</span> {s}
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-100">
          {err && <ErrorNote error={err} />}
          {!config && !err && <Spinner />}
          {config && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl">Start a design session</h2>
                <StageBadge state="live" />
              </div>
              <Field label="Property">
                <select className={inputCls} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}{p.isDemo ? " (demo property)" : ""}</option>
                  ))}
                </select>
              </Field>
              <Field label="Floor plan">
                <select className={inputCls} value={floorPlanId} onChange={(e) => setFloorPlanId(e.target.value)}>
                  {plans.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Offering" hint="The offering controls which references and finishes are available.">
                <select className={inputCls} value={offeringId} onChange={(e) => setOfferingId(e.target.value)}>
                  {config.offerings.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Client name (optional)">
                <input className={inputCls} value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Acme Pvt Ltd" />
              </Field>
              <ErrorNote error={error} />
              <Button size="lg" className="w-full" onClick={open} loading={busy} disabled={!propertyId || !floorPlanId || !offeringId}>
                Open {property?.name ?? "property"} <ArrowRight className="size-4" />
              </Button>
              {property?.isDemo && <p className="text-[11px] text-stone-400">{property.name} is set up as a demo property with a sample layout. Real floor plans can be added in Studio.</p>}
            </div>
          )}
        </div>
      </section>

      {mine.length > 0 && (
        <section className="mt-14">
          <h2 className="mb-3 font-display text-xl">Continue a session</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mine.slice(0, 6).map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 rounded-2xl bg-white p-4 ring-1 ring-stone-100 hover:ring-stone-200">
                <Link href={`/atlas/${s.id}`} className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{config?.properties.find((p) => p.id === s.propertyId)?.name ?? "Property"}</p>
                  <p className="flex items-center gap-1 text-xs text-stone-600">
                    <Clock className="size-3" /> {new Date(s.createdAt).toLocaleString()} {s.clientName && <Pill>{s.clientName}</Pill>}
                  </p>
                </Link>
                <div className="flex items-center gap-2">
                  <button
                    aria-label="Delete session"
                    className="rounded-full p-1.5 text-stone-400 hover:bg-stone-100 hover:text-danger"
                    onClick={async () => {
                      if (!confirm("Delete this design session?")) return;
                      await api(`/api/sessions/${s.id}`, { method: "DELETE" });
                      setMine((xs) => xs.filter((x) => x.id !== s.id));
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                  <Link href={`/atlas/${s.id}`} aria-label="Open session" className="text-stone-400 hover:text-ink">
                    <ArrowRight className="size-4" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
