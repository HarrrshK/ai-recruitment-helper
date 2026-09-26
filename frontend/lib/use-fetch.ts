"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

export type FetchState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

/** Load JSON from the backend with loading / error states, a reload, and local updates. */
export function useFetch<T>(path: string) {
  const [result, setResult] = useState<{ path: string; state: FetchState<T> }>({ path, state: { status: "loading" } });
  const state: FetchState<T> = result.path === path ? result.state : { status: "loading" };
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<T>(path)
      .then((data) => !cancelled && setResult({ path, state: { status: "ready", data } }))
      .catch((err: Error) => !cancelled && setResult({ path, state: { status: "error", message: err.message } }));
    return () => {
      cancelled = true;
    };
  }, [path, attempt]);

  const reload = useCallback(() => {
    setResult({ path, state: { status: "loading" } });
    setAttempt((n) => n + 1);
  }, [path]);

  /** Change the loaded data without refetching (e.g. after an upload or delete). */
  const update = useCallback((change: (data: T) => T) => {
    setResult((result) => (result.path === path && result.state.status === "ready" ? { path, state: { status: "ready", data: change(result.state.data) } } : result));
  }, [path]);

  return { state, reload, update };
}
