"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, RefreshCw, Search, X } from "lucide-react";
import { toast } from "sonner";
import { useFetch } from "@/lib/use-fetch";
import { apiFetch, downloadFile, patchJson, postJson } from "@/lib/api";
import type { Applicant, ApplicantDetail, RecruiterJob } from "@/lib/recruiter";
import { dateLabel, statusLabels } from "@/lib/portal";
import { ApplicationConversation } from "@/components/application-conversation";
import { MatchExplanation } from "@/components/candidate-applications";
import { ApplicantInterviews } from "@/components/recruiter/interviews";
import { PortalHeading, StatusBadge } from "@/components/portal-shared";
import { Field, LoadView, selectClass } from "@/components/recruiter/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function RecruiterApplicants() {
  const params = useSearchParams();
  const [job, setJob] = useState(params.get("job") || "all");
  const [status, setStatus] = useState(params.get("status") || "all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("rank");
  const jobs = useFetch<RecruiterJob[]>("/api/recruiter/jobs");
  const query = useFetch<Applicant[]>("/api/recruiter/applicants");
  return <><PortalHeading title="Applicants" description="Review candidates against the role they applied for." action={<Button onClick={query.reload} variant="outline"><RefreshCw className="size-4" />Refresh</Button>} /><div className="mb-6 flex flex-wrap items-end gap-3 border-y py-5"><div className="min-w-48 flex-1"><Field id="applicant-search" label="Candidate or job"><div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input id="applicant-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search applicants" className="pl-9" /></div></Field></div><Field id="applicant-job" label="Job"><select id="applicant-job" className={`${selectClass} max-w-60`} value={job} onChange={e => setJob(e.target.value)}><option value="all">All jobs</option>{jobs.state.status === "ready" && jobs.state.data.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</select></Field><Field id="applicant-status" label="Status"><select id="applicant-status" className={selectClass} value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field id="applicant-sort" label="Sort"><select id="applicant-sort" className={selectClass} value={sort} onChange={e => setSort(e.target.value)}><option value="rank">Match rank</option><option value="newest">Newest first</option></select></Field></div>
    <LoadView {...query}>{rows => { const filtered = rows.filter(a => (job === "all" || a.job_id === Number(job)) && (status === "all" || a.status === status) && `${a.candidate_name} ${a.job_title}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === "newest" ? b.id - a.id : (a.rank ?? Infinity) - (b.rank ?? Infinity) || b.id - a.id); return <><p className="mb-4 text-xs text-muted-foreground">{filtered.length} applicants · Rank is calculated within each job using current match scores.</p>{!filtered.length ? <p className="border-t py-12 text-center text-muted-foreground">No applicants match these filters.</p> : <div className="divide-y border-t">{filtered.map(a => <article key={a.id} className="grid items-center gap-4 py-5 md:grid-cols-[minmax(0,1.8fr)_110px_150px_40px]"><div className="min-w-0"><Link href={`/recruiter/applicants/${a.id}`} className="font-semibold hover:text-primary">{a.candidate_name}</Link><p className="mt-1 text-sm text-muted-foreground">{a.job_title}</p><p className="mt-2 text-xs text-muted-foreground">Applied {dateLabel(a.created_at)}</p></div><div><p className="text-lg font-semibold tabular-nums">{a.assessment ? `${a.assessment.overall_score}/100` : "Pending"}</p><p className={`mt-1 text-xs ${a.assessment_stale ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>{a.assessment_stale ? "Needs reassessment" : a.rank ? `Rank #${a.rank} for this job` : "Unranked"}</p></div><div><StatusBadge status={a.status} /></div><Link href={`/recruiter/applicants/${a.id}`} title="Review applicant" aria-label={`Review ${a.candidate_name}`} className={buttonVariants({ variant: "outline", size: "icon" })}><ArrowRight /></Link></article>)}</div>}</>; }}</LoadView>
  </>;
}

export function RecruiterApplicant({ applicationId }: { applicationId: string }) {
  const query = useFetch<ApplicantDetail>(`/api/recruiter/applicants/${applicationId}`);
  const refresh = () => { void apiFetch<ApplicantDetail>(`/api/recruiter/applicants/${applicationId}`).then(data => query.update(() => data)).catch(error => toast.error(error.message)); };
  return <LoadView {...query}>{app => <ApplicantReview application={app} reload={refresh} />}</LoadView>;
}
function ApplicantReview({ application: a, reload }: { application: ApplicantDetail; reload: () => void }) {
  const [tab, setTab] = useState("profile");
  const [decision, setDecision] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const closed = ["withdrawn", "rejected", "hired"].includes(a.status);
  async function assess() {
    setBusy(true);
    try { await postJson(`/api/portal/applications/${a.id}/evaluate${a.assessment_stale ? "?force=true" : ""}`); toast.success("Match assessment saved"); reload(); }
    catch (error) { toast.error((error as Error).message); } finally { setBusy(false); }
  }
  async function saveDecision(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await patchJson(`/api/portal/hr/applications/${a.id}/status`, { status: decision, note }); toast.success("Application status updated"); setDecision(""); setNote(""); reload(); }
    catch (error) { toast.error((error as Error).message); } finally { setBusy(false); }
  }
  return <><Link href={`/recruiter/applicants?job=${a.job_id}`} className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4" />Back to applicants</Link><PortalHeading title={a.candidate_name} description={`${a.job_title} · Applied ${dateLabel(a.created_at)}`} action={<StatusBadge status={a.status} />} />
    <div className="mb-7 flex flex-wrap items-center gap-3 border-y py-4"><Button variant="outline" onClick={() => downloadFile(`/api/recruiter/applicants/${a.id}/resume`, a.resume_name).catch(error => toast.error(error.message))}><Download className="size-4" />Download resume</Button>{!closed && <><Button disabled={busy || a.status === "shortlisted"} onClick={() => setDecision("shortlisted")}><Check className="size-4" />Shortlist</Button><Button variant="outline" disabled={busy} onClick={() => setDecision("rejected")}><X className="size-4" />Reject</Button><select aria-label="Other application decision" value={decision} onChange={e => setDecision(e.target.value)} className={selectClass}><option value="">More decisions</option>{["screened", "shortlisted", "interview", "offer", "hired", "rejected"].map(s => <option key={s} value={s}>{statusLabels[s]}</option>)}</select></>}<span className="ml-auto text-sm font-medium">Match: {a.assessment ? `${a.assessment.overall_score}/100` : "Not assessed"}</span></div>
    {decision && <form onSubmit={saveDecision} className="mb-7 space-y-4 border-b pb-6"><h2 className="text-lg font-semibold">{decision === "rejected" ? "Reject application" : `Update to ${statusLabels[decision]}`}</h2><Field id="decision-note" label="Reason / update shared with the candidate"><Textarea id="decision-note" value={note} onChange={e => setNote(e.target.value)} maxLength={1000} required rows={3} /></Field><div className="flex gap-2"><Button type="submit" variant={decision === "rejected" ? "destructive" : "default"} disabled={busy || !note.trim()}>Confirm decision</Button><Button variant="outline" onClick={() => setDecision("")}>Cancel</Button></div></form>}
    <Tabs value={tab} onValueChange={value => setTab(String(value))}><TabsList className="mb-7 flex h-auto max-w-full flex-wrap justify-start gap-1">{[["profile", "Candidate profile"], ["resume", "Resume"], ["match", "Match explanation"], ["interviews", "Interviews"], ["messages", "Messages"]].map(([value, label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}</TabsList>
      <TabsContent value="profile"><div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]"><section className="space-y-6"><div><h2 className="text-lg font-semibold">{a.profile.headline || "Professional profile"}</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">{a.profile.bio || "No introduction provided."}</p></div><dl className="grid gap-5 sm:grid-cols-2">{[["Email", a.email], ["Phone", a.profile.phone], ["Location", a.profile.location], ["Current position", a.profile.current_position]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-2 break-words text-sm">{value || "Not provided"}</dd></div>)}</dl><div><h3 className="mb-3 text-sm font-semibold">Profile skills</h3><div className="flex flex-wrap gap-2">{a.profile.skills.length ? a.profile.skills.map(s => <span key={s} className="rounded-md border px-2 py-1 text-xs">{s}</span>) : <p className="text-sm text-muted-foreground">No skills listed in profile.</p>}</div></div>{a.cover_letter && <section className="border-t pt-5"><h3 className="mb-3 text-sm font-semibold">Cover letter</h3><p className="whitespace-pre-wrap break-words text-sm leading-7">{a.cover_letter}</p></section>}</section><section className="border-t pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"><h2 className="mb-5 text-lg font-semibold">Application history</h2><ol className="space-y-5">{a.history.map((event, index) => <li key={index}><StatusBadge status={event.status} /><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{event.note}</p><time className="mt-1 block text-xs text-muted-foreground">{dateLabel(event.at)}</time></li>)}</ol></section></div></TabsContent>
      <TabsContent value="resume"><h2 className="mb-4 break-all text-lg font-semibold">{a.resume_name}</h2><pre className="max-w-4xl whitespace-pre-wrap break-words border-y py-6 font-sans text-sm leading-7">{a.resume_text}</pre></TabsContent>
      <TabsContent value="match">{a.assessment_stale && <p role="status" className="mb-5 border-l-2 border-amber-500 pl-4 text-sm text-amber-800 dark:text-amber-300">The job requirements changed after this assessment. Reassess before comparing this candidate with current applicants.</p>}{(!a.assessment || a.assessment_stale) && !closed && <Button onClick={assess} disabled={busy} className="mb-7"><RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />{busy ? "Assessing submitted resume..." : a.assessment_stale ? "Reassess applicant" : "Assess applicant"}</Button>}{a.assessment ? <MatchExplanation assessment={a.assessment} title="Match score explanation" /> : <p className="py-8 text-sm text-muted-foreground">No match score has been assigned yet.</p>}</TabsContent>
      <TabsContent value="interviews"><ApplicantInterviews applicationId={a.id} closed={closed} /></TabsContent>
      <TabsContent value="messages"><div className="max-w-3xl"><ApplicationConversation applicationId={a.id} /></div></TabsContent>
    </Tabs>
  </>;
}
