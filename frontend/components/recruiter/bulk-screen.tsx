"use client";
import { useEffect, useRef, useState } from "react";
import { Check, RefreshCw, Square, X } from "lucide-react";
import { apiFetch, postJson } from "@/lib/api";
import type { Applicant } from "@/lib/recruiter";
import { Button } from "@/components/ui/button";

type Progress = { total: number; done: number; failed: { name: string; error: string }[]; current: string; stopped: boolean };

export function BulkScreen({ jobId, onComplete }: { jobId?: number; onComplete: () => void }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const stop = useRef(false);
  const alive = useRef(true);
  const running = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; stop.current = true; }; }, []);
  async function screen() {
    if (running.current) return;
    running.current = true; stop.current = false; setBusy(true); setError("");
    const state: Progress = { total: 0, done: 0, failed: [], current: "", stopped: false };
    setProgress(state);
    try {
      const rows = await apiFetch<Applicant[]>(`/api/recruiter/applicants${jobId ? `?job_id=${jobId}` : ""}`);
      const pending = rows.filter(a => !["withdrawn", "rejected", "hired"].includes(a.status) && (!a.assessment || a.assessment_stale));
      state.total = pending.length;
      for (const applicant of pending) {
        if (stop.current || !alive.current) { state.stopped = true; break; }
        state.current = applicant.candidate_name;
        setProgress({ ...state });
        try { await postJson(`/api/portal/applications/${applicant.id}/evaluate${applicant.assessment_stale ? "?force=true" : ""}`); }
        catch (cause) { state.failed.push({ name: applicant.candidate_name, error: (cause as Error).message }); }
        state.done += 1;
        if (alive.current) setProgress({ ...state, failed: [...state.failed] });
      }
    } catch (cause) { if (alive.current) setError((cause as Error).message); }
    finally {
      running.current = false;
      if (alive.current) { setBusy(false); setProgress({ ...state, current: "" }); onComplete(); }
    }
  }
  return <section className="mb-6 border-b pb-5"><div className="flex flex-wrap items-center gap-3"><Button disabled={busy} onClick={screen}><RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />{busy ? "Screening candidates..." : "Screen all candidates & rank"}</Button>{busy && <Button variant="outline" onClick={() => { stop.current = true; }}><Square className="size-4" />Stop after current</Button>}</div>{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}{progress && <div role="status" className="mt-4 space-y-3 text-sm"><div className="flex items-center gap-2">{busy ? null : progress.failed.length ? <X className="size-4 text-destructive" /> : <Check className="size-4 text-emerald-600" />}<span>{busy ? `${progress.done} / ${progress.total} reviewed: ${progress.current}` : progress.stopped ? `Stopped: ${progress.done} / ${progress.total} reviewed` : `${progress.done - progress.failed.length} assessed, ${progress.failed.length} failed`}</span></div>{busy && <progress aria-label="Screening progress" max={Math.max(1, progress.total)} value={progress.done} className="h-2 w-full" />}{!busy && !error && progress.total === 0 && <p className="text-muted-foreground">No candidates awaiting assessment.</p>}{progress.failed.length > 0 && <ul className="space-y-2 text-destructive">{progress.failed.map((failure, index) => <li key={index} className="break-words">{failure.name}: {failure.error}</li>)}</ul>}</div>}</section>;
}
