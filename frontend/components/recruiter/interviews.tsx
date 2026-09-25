"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Copy, Plus, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useFetch } from "@/lib/use-fetch";
import { apiFetch, postJson, putJson } from "@/lib/api";
import { formatDateTime, interviewStatuses, type Feedback, type HiringInterview } from "@/lib/recruiter";
import { PortalHeading } from "@/components/portal-shared";
import { Field, LoadView, selectClass } from "@/components/recruiter/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function RecruiterInterviews() {
  const query = useFetch<HiringInterview[]>("/api/recruiter/interviews");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  return <><PortalHeading title="Interviews" description="Schedules, question sets and feedback for your applicants." /><div className="mb-6 flex flex-wrap gap-3 border-y py-5"><Input aria-label="Search interviews" placeholder="Search candidate or job" value={search} onChange={e => setSearch(e.target.value)} className="min-w-48 flex-1" /><select aria-label="Interview status filter" className={selectClass} value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option>{Object.entries(interviewStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div><LoadView {...query}>{rows => <InterviewRows interviews={rows.filter(i => (status === "all" || i.status === status) && `${i.candidate_name} ${i.job_title}`.toLowerCase().includes(search.toLowerCase()))} />}</LoadView></>;
}
function InterviewRows({ interviews }: { interviews: HiringInterview[] }) {
  return !interviews.length ? <p className="border-t py-12 text-sm text-muted-foreground">No interviews in this view. Open an applicant to arrange an interview.</p> : <div className="divide-y border-t">{interviews.map(i => <Link key={i.id} href={`/recruiter/interviews/${i.id}`} className="grid items-center gap-4 py-5 sm:grid-cols-[minmax(0,1fr)_minmax(140px,220px)_100px_20px]"><div className="min-w-0"><h2 className="font-semibold">{i.candidate_name}</h2><p className="mt-1 text-sm text-muted-foreground">{i.job_title} · {i.title}</p></div><div><p className="text-sm">{formatDateTime(i.scheduled_at)}</p><p className="mt-1 text-xs text-muted-foreground">{i.interviewer || "Interviewer not assigned"}</p></div><div><span className="rounded-md bg-muted px-2 py-1 text-xs">{interviewStatuses[i.status]}</span><p className="mt-2 text-xs text-muted-foreground">{i.feedback ? "Feedback saved" : "No feedback"}</p></div><ArrowRight className="size-4" /></Link>)}</div>;
}
export function ApplicantInterviews({ applicationId, closed }: { applicationId: number; closed: boolean }) {
  const query = useFetch<HiringInterview[]>(`/api/recruiter/interviews?application_id=${applicationId}`);
  const [adding, setAdding] = useState(false);
  return <><div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Interview rounds</h2>{!closed && <Button variant="outline" onClick={() => setAdding(!adding)}><Plus className="size-4" />Add interview</Button>}</div>{adding && <div className="mb-8 border-y py-6"><InterviewForm applicationId={applicationId} onSaved={() => { setAdding(false); query.reload(); }} /></div>}<LoadView {...query}>{rows => <InterviewRows interviews={rows} />}</LoadView></>;
}

function localTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function InterviewForm({ applicationId, initial, onSaved }: { applicationId: number; initial?: HiringInterview; onSaved: () => void }) {
  const [title, setTitle] = useState(initial?.title || "Technical interview");
  const [interviewer, setInterviewer] = useState(initial?.interviewer || "");
  const [date, setDate] = useState(localTime(initial?.scheduled_at));
  const [location, setLocation] = useState(initial?.location || "");
  const [status, setStatus] = useState(initial?.status || "planned");
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    const body = { title, interviewer, scheduled_at: date ? new Date(date).toISOString() : null, location, status };
    try { if (initial) await putJson(`/api/recruiter/interviews/${initial.id}`, body); else await postJson(`/api/recruiter/applicants/${applicationId}/interviews`, body); toast.success("Interview saved"); onSaved(); }
    catch (error) { toast.error((error as Error).message); } finally { setBusy(false); }
  }
  return <form onSubmit={save} className="max-w-3xl space-y-5"><div className="grid gap-5 sm:grid-cols-2"><Field id="interview-title" label="Interview title"><Input id="interview-title" value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} /></Field><Field id="interviewer" label="Interviewer"><Input id="interviewer" value={interviewer} onChange={e => setInterviewer(e.target.value)} maxLength={200} /></Field><Field id="interview-date" label="Date and time (your local time)"><Input id="interview-date" type="datetime-local" value={date} onChange={e => setDate(e.target.value)} required={status === "scheduled"} /></Field><Field id="interview-status" label="Interview status"><select id="interview-status" className={`${selectClass} w-full`} value={status} onChange={e => setStatus(e.target.value as HiringInterview["status"])}>{Object.entries(interviewStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field></div><Field id="interview-location" label="Meeting link or location"><Input id="interview-location" value={location} onChange={e => setLocation(e.target.value)} maxLength={500} /></Field><Button type="submit" disabled={busy}><CalendarDays className="size-4" />{busy ? "Saving..." : "Save interview"}</Button></form>;
}

export function RecruiterInterviewDetail({ interviewId }: { interviewId: string }) {
  const query = useFetch<HiringInterview>(`/api/recruiter/interviews/${interviewId}`);
  const refresh = () => { void apiFetch<HiringInterview>(`/api/recruiter/interviews/${interviewId}`).then(data => query.update(() => data)).catch(error => toast.error(error.message)); };
  return <LoadView {...query}>{interview => <InterviewDetail interview={interview} onSaved={refresh} />}</LoadView>;
}
function InterviewDetail({ interview: i, onSaved }: { interview: HiringInterview; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("schedule");
  async function generate() {
    setBusy(true);
    try { await postJson(`/api/recruiter/interviews/${i.id}/questions`); toast.success("Interview questions saved"); onSaved(); }
    catch (error) { toast.error((error as Error).message); } finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText((i.questions || []).map((q, index) => `${index + 1}. ${q.text}`).join("\n\n")); toast.success("Questions copied"); } catch { toast.error("Could not copy questions"); }
  }
  return <><Link href="/recruiter/interviews" className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4" />All interviews</Link><PortalHeading title={i.title} description={`${i.candidate_name} · ${i.job_title}`} action={<Link href={`/recruiter/applicants/${i.application_id}`} className={buttonVariants({ variant: "outline" })}>View applicant <ArrowRight className="size-4" /></Link>} /><div className="mb-7 flex flex-wrap gap-x-6 gap-y-2 border-y py-4 text-sm"><span className="font-medium">{interviewStatuses[i.status]}</span><span>{formatDateTime(i.scheduled_at)}</span><span className="text-muted-foreground">{i.interviewer || "Interviewer not assigned"}</span></div>
    <Tabs value={tab} onValueChange={value => setTab(String(value))}><TabsList className="mb-7 flex h-auto max-w-full flex-wrap justify-start"><TabsTrigger value="schedule">Schedule & status</TabsTrigger><TabsTrigger value="questions">Interview questions</TabsTrigger><TabsTrigger value="feedback">Feedback</TabsTrigger></TabsList><TabsContent value="schedule"><InterviewForm applicationId={i.application_id} initial={i} onSaved={onSaved} /></TabsContent><TabsContent value="questions"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Interview questions</h2>{i.questions?.length ? <Button variant="outline" onClick={copy}><Copy className="size-4" />Copy questions</Button> : <Button disabled={busy || ["completed", "cancelled"].includes(i.status)} onClick={generate}><Sparkles className="size-4" />{busy ? "Generating questions..." : "Generate questions"}</Button>}</div>{!i.questions?.length ? <p className="border-t py-10 text-sm text-muted-foreground">No questions generated for this interview yet.</p> : <ol className="divide-y border-t">{i.questions.map((q, index) => <li key={q.id} className="py-6"><div className="mb-3 flex flex-wrap gap-2 text-xs text-muted-foreground"><span>Question {index + 1}</span><span>· {q.competency.replaceAll("_", " ")}</span><span>· {q.difficulty}</span></div><h3 className="max-w-4xl text-base font-semibold leading-7">{q.text}</h3><details className="mt-4 text-sm"><summary className="cursor-pointer text-primary">Strong answer indicators</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">{q.good_answer_signals.map(signal => <li key={signal}>{signal}</li>)}</ul></details></li>)}</ol>}</TabsContent><TabsContent value="feedback"><InterviewFeedback interview={i} onSaved={onSaved} /></TabsContent></Tabs>
  </>;
}
const criteria = [["technical", "Technical ability"], ["problem_solving", "Problem solving"], ["communication", "Communication"], ["role_fit", "Role fit"]] as const;
function InterviewFeedback({ interview, onSaved }: { interview: HiringInterview; onSaved: () => void }) {
  const [scores, setScores] = useState<Record<string, string>>(Object.fromEntries(criteria.map(([key]) => [key, interview.feedback?.[key]?.toString() ?? ""])));
  const [notes, setNotes] = useState(interview.feedback?.notes || "");
  const [recommendation, setRecommendation] = useState<Feedback["recommendation"]>(interview.feedback?.recommendation || "hold");
  const [shared, setShared] = useState(interview.candidate_feedback || "");
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await putJson(`/api/recruiter/interviews/${interview.id}/feedback`, { ...Object.fromEntries(criteria.map(([key]) => [key, Number(scores[key])])), recommendation, notes, candidate_feedback: shared }); toast.success("Interview feedback saved"); onSaved(); }
    catch (error) { toast.error((error as Error).message); } finally { setBusy(false); }
  }
  return <form onSubmit={save} className="max-w-3xl space-y-7"><section><h2 className="mb-5 text-lg font-semibold">Interviewer scorecard</h2><div className="grid gap-5 sm:grid-cols-2">{criteria.map(([key, label]) => <Field key={key} id={`feedback-${key}`} label={`${label} (0-10)`}><Input id={`feedback-${key}`} type="number" min={0} max={10} step={0.5} value={scores[key]} required onChange={e => setScores({ ...scores, [key]: e.target.value })} /></Field>)}</div></section><Field id="feedback-notes" label="Internal feedback and evidence"><Textarea id="feedback-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={6} required maxLength={6000} /></Field><Field id="feedback-recommendation" label="Recommendation"><select id="feedback-recommendation" className={selectClass} value={recommendation} onChange={e => setRecommendation(e.target.value as Feedback["recommendation"])}><option value="hire">Hire</option><option value="hold">Hold / further discussion</option><option value="reject">Reject</option></select></Field><section className="border-t pt-6"><Field id="candidate-feedback" label="Feedback shared with the candidate (optional)"><Textarea id="candidate-feedback" rows={4} value={shared} maxLength={3000} onChange={e => setShared(e.target.value)} /></Field></section>{interview.feedback?.author && <p className="text-xs text-muted-foreground">Last saved by {interview.feedback.author} · {formatDateTime(interview.feedback.recorded_at || null)}</p>}<Button type="submit" disabled={busy || interview.status === "cancelled"}><Save className="size-4" />{busy ? "Saving..." : "Save feedback"}</Button></form>;
}
