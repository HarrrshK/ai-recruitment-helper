import type { ReactNode } from "react";
import { statusLabels } from "@/lib/portal";

export function PortalHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold">{title}</h1>{description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}</div>{action}</div>;
}
export function StatusBadge({ status }: { status: string }) {
  const color = ["offer", "hired"].includes(status) ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : ["rejected", "withdrawn"].includes(status) ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" : status === "interview" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200";
  return <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${color}`}>{statusLabels[status] || status}</span>;
}
export function LoadingPortal() { return <p role="status" className="py-12 text-sm text-muted-foreground">Loading...</p>; }
