"use client";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "./api";

type Status = { persistence: { kind: string; durable: boolean; detail: string }; staffAuth: { openDevAccess: boolean } };

/** Shows environment warnings that must never be hidden (non-durable storage, open dev access). */
export function StatusBanner() {
  const [s, setS] = useState<Status | null>(null);
  useEffect(() => {
    api<Status>("/api/status").then(setS).catch(() => undefined);
  }, []);
  if (!s) return null;
  const msgs: string[] = [];
  if (!s.persistence.durable) msgs.push(s.persistence.detail);
  if (s.staffAuth.openDevAccess) msgs.push("Local development mode: Studio is open because no staff passcode is set. Set ATLAS_ADMIN_PASSCODE before sharing this app.");
  if (!msgs.length) return null;
  return (
    <div className="no-print border-b border-planned/30 bg-planned-soft">
      {msgs.map((m) => (
        <p key={m} className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-1.5 text-xs text-planned sm:px-6">
          <AlertTriangle className="size-3.5 shrink-0" /> {m}
        </p>
      ))}
    </div>
  );
}
