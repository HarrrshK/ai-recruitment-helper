"use client";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Delete", busy = false, onConfirm }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string;
  confirmLabel?: string; busy?: boolean; onConfirm: () => void;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={onConfirm}>{busy ? "Working..." : confirmLabel}</Button></DialogFooter></DialogContent></Dialog>;
}
