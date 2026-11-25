"use client";
import { useCallback, useEffect, useState } from "react";
import type { sessionSummary } from "@/modules/selections/service";
import { api } from "./api";

export type SessionSummary = Awaited<ReturnType<typeof sessionSummary>>;
export type RoomSummary = SessionSummary["rooms"][number];

export function useSession(sessionId: string) {
  const [data, setData] = useState<SessionSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reload = useCallback(
    () =>
      api<SessionSummary>(`/api/sessions/${sessionId}`)
        .then((d) => {
          setData(d);
          setErr(null);
        })
        .catch((e) => setErr(e.message)),
    [sessionId],
  );
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, err, reload, setData };
}
