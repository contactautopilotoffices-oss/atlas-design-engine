"use client";
import { ReferenceGallery, useConfig } from "@/components/references";
import { ErrorNote, Spinner, StageBadge } from "@/components/ui";

export default function LibraryPage() {
  const { config, err } = useConfig();
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-bronze">Our portfolio</p>
          <h1 className="font-display text-4xl">Reference library</h1>
          <p className="text-sm text-stone-600">Approved rooms from completed projects, with their source presentation page. Open any image to see full details and similar work.</p>
        </div>
        <StageBadge state="live" />
      </div>
      {err && <ErrorNote error={err} />}
      {!config && !err && <Spinner />}
      {config && <ReferenceGallery config={config} />}
    </div>
  );
}
