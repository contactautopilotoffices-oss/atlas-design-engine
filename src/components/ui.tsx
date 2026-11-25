"use client";
import { Loader2, X } from "lucide-react";
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

export const cx = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(" ");

export function Button({ variant = "primary", size = "md", loading, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze",
        size === "sm" && "px-3 py-1.5 text-xs",
        size === "md" && "px-4 py-2 text-sm",
        size === "lg" && "px-6 py-3 text-base",
        variant === "primary" && "bg-ink text-paper hover:bg-ink-soft",
        variant === "secondary" && "bg-white text-ink border border-stone-200 hover:border-stone-400",
        variant === "ghost" && "text-ink-soft hover:bg-stone-100",
        variant === "danger" && "bg-danger text-white hover:opacity-90",
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export type StageState = "live" | "built-awaiting-config" | "built-unverified" | "planned";
const STATE_TEXT: Record<StageState, string> = {
  live: "Live",
  "built-unverified": "Built, not yet verified live",
  "built-awaiting-config": "Awaiting configuration",
  planned: "Planned / not live",
};

/** Mirrors the architecture diagram: solid green = live, dashed orange = not live yet. */
export function StageBadge({ state, className }: { state: StageState; className?: string }) {
  const live = state === "live";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        live ? "bg-live-soft text-live live-outline" : "bg-planned-soft text-planned planned-outline",
        className,
      )}
    >
      <span className={cx("size-1.5 rounded-full", live ? "bg-live" : "bg-planned")} />
      {STATE_TEXT[state]}
    </span>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "demo" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "neutral" && "bg-stone-100 text-ink-soft",
        tone === "good" && "bg-live-soft text-live",
        tone === "warn" && "bg-planned-soft text-planned",
        tone === "bad" && "bg-danger-soft text-danger",
        tone === "demo" && "bg-danger text-white tracking-wide",
      )}
    >
      {children}
    </span>
  );
}

export function Swatches({ palette, size = "sm" }: { palette: Array<{ hex: string; share?: number }>; size?: "sm" | "md" }) {
  return (
    <div className="flex items-center gap-1">
      {palette.slice(0, 5).map((p) => (
        <span key={p.hex} title={p.hex} className={cx("rounded-full ring-1 ring-black/10", size === "sm" ? "size-3.5" : "size-6")} style={{ background: p.hex }} />
      ))}
    </div>
  );
}

export function Modal({ open, onClose, children, wide, title }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean; title?: string }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm fade-in" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className={cx("relative max-h-[92vh] w-full overflow-auto rounded-2xl bg-canvas shadow-2xl", wide ? "max-w-6xl" : "max-w-xl")} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-3 top-3 z-10 rounded-full bg-white/90 p-2 shadow hover:bg-white" aria-label="Close">
          <X className="size-4" />
        </button>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-stone-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-stone-400">{hint}</span>}
    </label>
  );
}

export const inputCls = "w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-bronze focus:ring-2 focus:ring-bronze/20";

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-200 bg-white/60 px-6 py-12 text-center">
      <p className="font-display text-xl">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-stone-600">{children}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-stone-600">
      <Loader2 className="size-4 animate-spin" /> {label ?? "Loading"}
    </div>
  );
}
