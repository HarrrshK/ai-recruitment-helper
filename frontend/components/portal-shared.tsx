import type { ReactNode } from "react";
import { statusLabels } from "@/lib/portal";

export function PortalHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="workspace-page-heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}
export function StatusBadge({ status }: { status: string }) {
  const color = ["offer", "hired"].includes(status) ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : ["rejected", "withdrawn"].includes(status) ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" : status === "interview" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200";
  return <span className={`workspace-status inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${color}`}><span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-current" />{statusLabels[status] || status}</span>;
}
export function LoadingPortal() { return <div role="status" className="space-y-6 py-8"><span className="sr-only">Loading workspace...</span><div className="h-6 w-48 animate-pulse rounded bg-muted" /><div className="grid grid-cols-3 gap-6">{[0, 1, 2].map(item => <div key={item} className="h-16 animate-pulse rounded bg-muted/70" />)}</div>{[0, 1, 2].map(item => <div key={item} className="flex items-center gap-4 border-t py-5"><div className="size-10 animate-pulse rounded-md bg-muted" /><div className="flex-1 space-y-3"><div className="h-3 w-2/5 animate-pulse rounded bg-muted" /><div className="h-3 w-3/5 animate-pulse rounded bg-muted/60" /></div></div>)}</div>; }
