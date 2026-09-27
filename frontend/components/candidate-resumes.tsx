"use client";
import { useRef, useState } from "react";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, del, downloadFile } from "@/lib/api";
import { useFetch } from "@/lib/use-fetch";
import { dateLabel, type Resume } from "@/lib/portal";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { LoadingPortal, PortalHeading } from "@/components/portal-shared";
import { ConfirmDialog } from "@/components/confirm-dialog";

export function CandidateResumes() {
  const { state, reload } = useFetch<Resume[]>("/api/portal/resumes");
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Choose a file smaller than 5 MB"); return; }
    setBusy(true);
    try { const data = new FormData(); data.append("file", file); await apiFetch("/api/portal/resumes", { method: "POST", body: data }); reload(); toast.success("Resume uploaded"); }
    catch (error) { toast.error((error as Error).message); } finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  async function remove(id: number) {
    setBusy(true);
    try { await del(`/api/portal/resumes/${id}`); setRemoving(null); reload(); toast.success("Resume removed from your library"); }
    catch (error) { toast.error((error as Error).message); } finally { setBusy(false); }
  }
  return <><PortalHeading title="Your resumes" description="PDF, DOCX or TXT. Maximum 5 MB per file." />
    <div className="mb-8 flex flex-wrap items-center justify-between gap-5 border-y py-7" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) void upload(e.dataTransfer.files[0]); }}>
      <div className="flex items-center gap-4"><FileText className="size-9 text-primary" /><div><h2 className="font-semibold">Upload a resume</h2><p className="mt-1 text-sm text-muted-foreground">Keep different versions for different opportunities.</p></div></div>
      <input ref={input} type="file" accept=".pdf,.docx,.txt" aria-label="Resume file" className="sr-only" onChange={e => void upload(e.target.files?.[0])} disabled={busy} />
      <Button onClick={() => input.current?.click()} disabled={busy}><Upload className="size-4" />{busy ? "Working..." : "Upload resume"}</Button>
    </div>
    {state.status === "loading" ? <LoadingPortal /> : state.status === "error" ? <ErrorState message={state.message} onRetry={reload} /> : !state.data.length ? <p className="py-10 text-center text-muted-foreground">No resumes uploaded yet.</p> : <ul className="divide-y">{state.data.map(resume => <li key={resume.id} className="flex flex-wrap items-center justify-between gap-4 py-5"><div className="min-w-0"><h2 className="break-all font-medium">{resume.filename}</h2><p className="mt-1 text-xs text-muted-foreground">{Math.ceil(resume.size / 1024)} KB · Uploaded {dateLabel(resume.created_at)}</p></div><div className="flex gap-2"><Button variant="outline" size="icon" title="Download resume" aria-label={`Download ${resume.filename}`} onClick={() => downloadFile(`/api/portal/resumes/${resume.id}/download`, resume.filename).catch(e => toast.error(e.message))}><Download /></Button><Button variant="outline" size="icon" title="Remove resume" aria-label={`Remove ${resume.filename}`} onClick={() => setRemoving(resume.id)} disabled={busy}><Trash2 /></Button></div><ConfirmDialog open={removing === resume.id} onOpenChange={open => setRemoving(open ? resume.id : null)} title="Remove this resume?" description="Submitted applications keep their attached copy. This resume will no longer be available for new applications." busy={busy} onConfirm={() => void remove(resume.id)} /></li>)}</ul>}
  </>;
}
