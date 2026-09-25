"use client";
import { useState } from "react";
import { toast } from "sonner";
import { useFetch } from "@/lib/use-fetch";
import { patchJson } from "@/lib/api";
import { statusLabels, type Application } from "@/lib/portal";
import { ApplicationConversation } from "@/components/application-conversation";
import { LoadingPortal, PortalHeading, StatusBadge } from "@/components/portal-shared";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function PortalMessages({ recruiter = false }: { recruiter?: boolean }) {
  const { state, reload } = useFetch<Application[]>(recruiter ? "/api/portal/hr/applications" : "/api/portal/applications");
  const [selected, setSelected] = useState<number | null>(null);
  if (state.status === "loading") return <LoadingPortal />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;
  const application = state.data.find(a => a.id === selected) || state.data[0];
  return <><PortalHeading title={recruiter ? "Candidate conversations" : "Messages"} description={recruiter ? "Application updates and direct replies to candidates." : "Conversations with the hiring team, organised by application."} />
    {!application ? <p className="border-t py-12 text-center text-muted-foreground">{recruiter ? "No candidate applications yet." : "Your conversations will appear here after you apply to a job."}</p> : <div className="grid gap-8 border-t pt-6 md:grid-cols-[260px_minmax(0,1fr)]"><nav aria-label="Application conversations" className="space-y-1">{state.data.map(a => <button key={a.id} onClick={() => setSelected(a.id)} aria-pressed={a.id === application.id} className={`w-full rounded-md p-3 text-left ${a.id === application.id ? "bg-primary/10" : "hover:bg-muted"}`}><span className="block break-words text-sm font-semibold">{a.job_title}</span>{recruiter && <span className="mt-1 block text-xs text-muted-foreground">{a.candidate_name}</span>}<span className="mt-2 inline-block"><StatusBadge status={a.status} /></span></button>)}</nav><div className="min-w-0 space-y-8">{recruiter && <StatusEditor key={`status-${application.id}`} application={application} onSaved={reload} />}<ApplicationConversation key={application.id} applicationId={application.id} /></div></div>}
  </>;
}
function StatusEditor({ application, onSaved }: { application: Application; onSaved: () => void }) {
  const [status, setStatus] = useState(application.status);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await patchJson(`/api/portal/hr/applications/${application.id}/status`, { status, note }); toast.success("Candidate status updated"); onSaved(); }
    catch (error) { toast.error((error as Error).message); } finally { setBusy(false); }
  }
  if (application.status === "withdrawn") return <p className="text-sm text-muted-foreground">The candidate withdrew this application.</p>;
  return <form onSubmit={save} className="space-y-3 border-b pb-6"><h2 className="text-lg font-semibold">Application status</h2><div className="flex items-center gap-3 text-sm"><label htmlFor="application-stage">Stage</label><select id="application-stage" value={status} onChange={e => setStatus(e.target.value)} className="h-9 rounded-md border bg-background px-3">{Object.entries(statusLabels).filter(([key]) => key !== "withdrawn").map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></div><label className="block text-sm" htmlFor="status-note">Update for the candidate</label><Textarea id="status-note" value={note} onChange={e => setNote(e.target.value)} required maxLength={1000} /><Button type="submit" disabled={busy || !note.trim()}>{busy ? "Updating..." : "Update status"}</Button></form>;
}
