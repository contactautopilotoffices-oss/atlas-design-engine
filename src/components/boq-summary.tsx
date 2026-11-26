"use client";
import { Calculator, Download } from "lucide-react";
import { boqToCsv, formatMoney, type RoomBoqEstimate, type SessionBoqSummary } from "@/modules/boq/calculator";
import { Button, cx, Pill } from "./ui";

export function downloadBoqCsv(boq: SessionBoqSummary, filePrefix = "atlas-boq") {
  const csv = boqToCsv(boq);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filePrefix}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Shared project-level BOQ & tier comparison dashboard used on Summary and Handoff pages. */
export function ProjectBoqPanel({ boq, filePrefix }: { boq: SessionBoqSummary; filePrefix?: string }) {
  return (
    <section className="rounded-3xl bg-white p-5 ring-1 ring-stone-200">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 pb-4">
        <div>
          <p className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.2em] text-bronze">
            <Calculator className="size-3.5" /> Bill of Quantities (BOQ)
          </p>
          <h2 className="font-display text-2xl">
            Estimated Fit-Out Total: {formatMoney(boq.selectedTotalAmount, boq.currency)}
          </h2>
          <p className="text-xs text-stone-600">
            {boq.totalFloorAreaSqft.toLocaleString()} sq ft total floor area · {boq.totalSeats} seats ·{" "}
            {formatMoney(boq.selectedCostPerSqft, boq.currency)} / sq ft blended average
          </p>
        </div>
        <Button variant="secondary" size="sm" className="no-print" onClick={() => downloadBoqCsv(boq, filePrefix)}>
          <Download className="size-4" /> Export BOQ (CSV)
        </Button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Package Comparison (Full Floor)</p>
          <div className={cx("grid gap-2", boq.tierComparison.length <= 2 ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
            {boq.tierComparison.map((t) => (
              <div key={t.offeringId} className="rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-100">
                <p className="text-xs font-medium text-stone-600">{t.offeringName}</p>
                <p className="mt-0.5 text-lg font-semibold text-ink">{formatMoney(t.totalAmount, boq.currency)}</p>
                <p className="text-[11px] text-stone-500">{formatMoney(t.costPerSqft, boq.currency)} / sq ft</p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Category Split (Selected Tiers)</p>
          <div className="space-y-1.5">
            {boq.byCategory.map((c) => {
              const pct = boq.selectedTotalAmount > 0 ? Math.round((c.amount / boq.selectedTotalAmount) * 100) : 0;
              return (
                <div key={c.category} className="flex items-center gap-3 text-xs">
                  <span className="w-40 truncate text-stone-600">{c.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100">
                    <div className="h-full rounded-full bg-bronze" style={{ width: `${Math.max(2, pct)}%` }} />
                  </div>
                  <span className="w-24 text-right font-medium text-ink">{formatMoney(c.amount, boq.currency)}</span>
                  <span className="w-8 text-right text-stone-400">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Compact itemized BOQ table for a single room card. */
export function RoomBoqTable({ boq, currency }: { boq: RoomBoqEstimate; currency: string }) {
  return (
    <details className="rounded-2xl bg-stone-50 p-3 text-xs ring-1 ring-stone-100">
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 font-medium text-ink">
        <span>
          Room BOQ · <Pill tone="good">{boq.offeringName}</Pill> ({boq.metrics.floorAreaSqft} sq ft
          {boq.metrics.seatCount > 0 ? `, ${boq.metrics.seatCount} seats` : ""})
        </span>
        <span className="font-semibold">
          {formatMoney(boq.totalAmount, currency)} ({formatMoney(boq.costPerSqft, currency)}/sq ft)
        </span>
      </summary>
      <div className="mt-2 overflow-x-auto rounded-xl bg-white ring-1 ring-stone-100">
        <table className="w-full text-xs">
          <thead className="bg-stone-50 text-left text-stone-600">
            <tr>
              <th className="px-2.5 py-1.5 font-medium">Category</th>
              <th className="px-2.5 py-1.5 font-medium">Item</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Qty</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Rate</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {boq.lines.map((l) => (
              <tr key={l.itemId} className="border-t border-stone-100">
                <td className="px-2.5 py-1.5 whitespace-nowrap text-stone-500">{l.categoryLabel}</td>
                <td className="px-2.5 py-1.5">
                  <span className="font-medium text-ink">{l.name}</span>
                  {l.specification && <span className="block text-[10px] text-stone-500">{l.specification}</span>}
                </td>
                <td className="px-2.5 py-1.5 text-right whitespace-nowrap">{l.quantity} {l.unit}</td>
                <td className="px-2.5 py-1.5 text-right whitespace-nowrap">{formatMoney(l.unitRate, currency)}</td>
                <td className="px-2.5 py-1.5 text-right font-medium whitespace-nowrap">{formatMoney(l.amount, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
