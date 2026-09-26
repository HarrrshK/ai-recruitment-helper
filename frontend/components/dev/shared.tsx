"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
export { Field, LoadView, selectClass } from "@/components/recruiter/shared";

export function DevHeading({ title, label, refresh, action }: { title: string; label: string; refresh?: () => void; action?: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="mb-2 text-xs uppercase text-emerald-700 dark:text-emerald-400">{label}</p><h1 className="text-3xl font-semibold">{title}</h1></div><div className="flex items-center gap-3">{action}{refresh && <Button variant="outline" size="icon" onClick={refresh} title="Refresh data" aria-label="Refresh data"><RefreshCw /></Button>}</div></div>;
}
export function ConfirmAction({ title, description, onConfirm, children }: { title: string; description: string; onConfirm: () => Promise<void>; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return <><Button variant="outline" aria-label={title} title={title} onClick={() => setOpen(true)}>{children}</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); setOpen(false); } catch (error) { toast.error((error as Error).message); } finally { setBusy(false); } }}>{busy ? "Working..." : "Confirm"}</Button></DialogFooter></DialogContent></Dialog></>;
}
export function TableWrap({ children }: { children: React.ReactNode }) { return <div className="min-w-0 overflow-x-auto rounded-md border bg-background/60">{children}</div>; }
