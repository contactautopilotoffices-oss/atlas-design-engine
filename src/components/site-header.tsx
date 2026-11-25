"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

export function SiteHeader() {
  const path = usePathname();
  const studio = path.startsWith("/studio");
  const link = (href: string, label: string, active: boolean) => (
    <Link href={href} className={cx("rounded-full px-3 py-1.5 text-sm transition", active ? "bg-ink text-paper" : "text-ink-soft hover:bg-stone-100")}>
      {label}
    </Link>
  );
  return (
    <header className="no-print sticky top-0 z-40 border-b border-stone-100 bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-display text-xl font-semibold tracking-tight">ATLAS</span>
          <span className="hidden text-[11px] uppercase tracking-[0.22em] text-stone-600 sm:inline">Design Engine</span>
        </Link>
        <nav className="flex items-center gap-1">
          {link("/", "Workspace", path === "/" || path.startsWith("/atlas"))}
          {link("/library", "Reference library", path.startsWith("/library"))}
          <span className="mx-2 h-5 w-px bg-stone-200" />
          {link("/studio", "Studio", studio)}
        </nav>
      </div>
    </header>
  );
}
