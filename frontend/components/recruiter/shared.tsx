"use client";
import type { ReactNode } from "react";
import { LoadingPortal } from "@/components/portal-shared";
import { ErrorState } from "@/components/states";
import type { FetchState } from "@/lib/use-fetch";

export function LoadView<T>({ state, reload, children }: { state: FetchState<T>; reload: () => void; children: (data: T) => ReactNode }) {
  if (state.status === "loading") return <LoadingPortal />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;
  return <>{children(state.data)}</>;
}
export function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return <div className="min-w-0 space-y-2"><label htmlFor={id} className="block text-sm font-medium">{label}</label>{children}</div>;
}
export const selectClass = "h-9 max-w-full rounded-md border bg-background px-3 text-sm";
