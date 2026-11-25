"use client";
import { BarChart3, Boxes, Map as MapIcon, ClipboardCheck, FolderOpen, Gauge, LogOut, Palette, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/components/api";
import { Button, cx, ErrorNote, inputCls, Spinner } from "@/components/ui";

type Who = { signedIn: boolean; role?: "admin" | "designer"; openDevAccess?: boolean };

const NAV = [
  { href: "/studio", label: "Status", icon: Gauge, roles: ["admin", "designer"] },
  { href: "/studio/projects", label: "Projects & uploads", icon: FolderOpen, roles: ["admin"] },
  { href: "/studio/plans", label: "Floor plans", icon: MapIcon, roles: ["admin", "designer"] },
  { href: "/studio/review", label: "Reference review", icon: ClipboardCheck, roles: ["admin", "designer"] },
  { href: "/studio/intelligence", label: "Design intelligence", icon: Palette, roles: ["admin", "designer"] },
  { href: "/studio/designer", label: "Designer approval", icon: Boxes, roles: ["admin", "designer"] },
  { href: "/studio/generation", label: "AI generation activity", icon: Sparkles, roles: ["admin", "designer"] },
  { href: "/studio/admin", label: "Administration", icon: Settings, roles: ["admin"] },
];

function Login({ onDone }: { onDone: () => void }) {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto mt-24 w-full max-w-sm rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-100">
      <h1 className="font-display text-2xl">Studio sign-in</h1>
      <p className="mb-4 text-sm text-stone-600">For our design and admin team. Clients do not need to sign in.</p>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            await api("/api/staff/session", { method: "POST", json: { passcode: pass } });
            onDone();
          } catch (x) {
            setErr((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input type="password" autoFocus className={inputCls} placeholder="Staff passcode" value={pass} onChange={(e) => setPass(e.target.value)} />
        <ErrorNote error={err} />
        <Button className="w-full" loading={busy}>Sign in</Button>
      </form>
    </div>
  );
}

export default function StudioLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [who, setWho] = useState<Who | null>(null);
  const load = () => api<Who>("/api/staff/session").then(setWho).catch(() => setWho({ signedIn: false }));
  useEffect(() => {
    load();
  }, []);
  if (!who) return <div className="p-10"><Spinner /></div>;
  if (!who.signedIn) return <Login onDone={load} />;
  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-1 gap-6 px-4 py-6 sm:px-6">
      <aside className="hidden w-56 shrink-0 md:block">
        <nav className="sticky top-20 space-y-1">
          <p className="mb-3 px-3 text-[11px] uppercase tracking-[0.2em] text-stone-600">Studio · {who.role}</p>
          {NAV.filter((n) => n.roles.includes(who.role!)).map((n) => {
            const active = n.href === "/studio" ? path === "/studio" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={cx("flex items-center gap-2 rounded-xl px-3 py-2 text-sm", active ? "bg-ink text-paper" : "text-ink-soft hover:bg-stone-100")}>
                <n.icon className="size-4" /> {n.label}
              </Link>
            );
          })}
          {!who.openDevAccess && (
            <button onClick={async () => { await api("/api/staff/session", { method: "DELETE" }); load(); }} className="mt-4 flex items-center gap-2 px-3 py-2 text-sm text-stone-600 hover:text-ink">
              <LogOut className="size-4" /> Sign out
            </button>
          )}
          <Link href="/studio/admin#audit" className="flex items-center gap-2 px-3 py-2 text-xs text-stone-400 hover:text-ink"><BarChart3 className="size-3.5" /> Audit log</Link>
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
