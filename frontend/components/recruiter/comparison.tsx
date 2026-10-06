"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, Download, GitCompareArrows, Minus, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { downloadFile, postJson } from "@/lib/api";
import type { ApplicantDetail, HiringInterview, RecruiterJob } from "@/lib/recruiter";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/portal-shared";

type ComparedCandidate = ApplicantDetail & {
  resume_sections: { education: string[]; experience: string[]; projects: string[] };
  interviews: HiringInterview[];
};
type Comparison = { job: RecruiterJob; candidates: ComparedCandidate[] };
const views = ["Overview", "Skills & gaps", "Resume evidence", "Interviews"] as const;
type View = typeof views[number];

export function CandidateComparison({ jobId, ids, onClose }: { jobId: number; ids: number[]; onClose: () => void }) {
  const [data, setData] = useState<Comparison | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<View>("Overview");
  const [differences, setDifferences] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const selection = ids.join(",");
  useEffect(() => {
    const controller = new AbortController();
    postJson<Comparison>("/api/recruiter/comparison", { job_id: jobId, application_ids: selection.split(",").map(Number) }, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setData(result); setError(""); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [jobId, selection, attempt]);
  const candidates = data?.candidates || [];
  const skillState = (candidate: ComparedCandidate, skill: string) => {
    if (candidate.assessment_stale) return "Outdated";
    return candidate.assessment?.skill_details?.find(item => item.skill.toLowerCase() === skill.toLowerCase())?.status || "Not assessed";
  };
  const row = (label: string, render: (candidate: ComparedCandidate) => ReactNode, note?: string) => <tr key={label}><th scope="row"><span>{label}</span>{note && <p className="mt-2 text-xs font-normal leading-5 text-muted-foreground">{note}</p>}</th>{candidates.map(candidate => <td key={candidate.id}>{render(candidate)}</td>)}</tr>;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="comparison-dialog recruiter-workspace flex h-[90dvh] w-[96vw] max-w-[1440px] flex-col gap-0 overflow-hidden rounded-lg p-0 sm:max-w-[1440px]">
    <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12 sm:px-7"><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-primary"><GitCompareArrows className="size-4" />Candidate comparison</div><DialogTitle className="text-xl leading-7">{data?.job.title || "Loading job comparison"}</DialogTitle><DialogDescription>Compare submitted evidence and progress for this role. Hiring decisions stay with your team.</DialogDescription></DialogHeader>
    {error ? <div role="alert" className="space-y-4 p-8"><p>{error}</p><Button variant="outline" onClick={() => { setError(""); setAttempt(value => value + 1); }}><RefreshCw className="size-4" />Retry comparison</Button></div> : !data ? <div role="status" className="space-y-5 p-7"><div className="h-5 w-56 animate-pulse rounded bg-muted" /><div className="grid grid-cols-2 gap-5">{[0, 1].map(value => <div key={value} className="h-64 animate-pulse rounded bg-muted" />)}</div><p className="text-sm text-muted-foreground">Gathering application evidence...</p></div> : <>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-5 py-3 sm:px-7"><div role="tablist" aria-label="Comparison focus" className="flex max-w-full gap-1 overflow-x-auto">{views.map(label => <button key={label} role="tab" aria-selected={view === label} aria-controls="comparison-panel" id={`compare-${label.replaceAll(" ", "-")}`} onClick={() => setView(label)} className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors ${view === label ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"}`}>{label}</button>)}</div>{view === "Skills & gaps" && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={differences} onChange={event => setDifferences(event.target.checked)} />Differences only</label>}</div>
      <div className="flex shrink-0 items-center justify-between border-b px-5 py-2 text-xs text-muted-foreground lg:hidden"><span>{candidates.length} applicants</span><div className="flex gap-1"><Button size="icon-sm" variant="ghost" title="Previous candidate columns" aria-label="Previous candidate columns" onClick={() => scroller.current?.scrollBy({ left: -280, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })}><ChevronLeft className="size-4" /></Button><Button size="icon-sm" variant="ghost" title="Next candidate columns" aria-label="Next candidate columns" onClick={() => scroller.current?.scrollBy({ left: 280, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })}><ChevronRight className="size-4" /></Button></div></div>
      <div ref={scroller} id="comparison-panel" role="tabpanel" aria-labelledby={`compare-${view.replaceAll(" ", "-")}`} className="min-h-0 flex-1 overflow-auto" tabIndex={0}>
        <table className="comparison-table" style={{ minWidth: 180 + candidates.length * 270 }}><caption className="sr-only">{view} for applicants to {data.job.title}</caption><colgroup><col style={{ width: 180 }} />{candidates.map(candidate => <col key={candidate.id} style={{ width: `${100 / candidates.length}%` }} />)}</colgroup>
          <thead><tr><th scope="col"><p className="text-xs uppercase text-muted-foreground">Role criteria</p><p className="mt-2 text-sm">{data.job.requirements?.min_years_experience ?? 0}+ years</p><p className="mt-1 text-xs font-normal text-muted-foreground">{candidates.length} selected applicants</p></th>{candidates.map((candidate, index) => <th scope="col" key={candidate.id}><div className={`compare-avatar compare-avatar-${index}`}>{candidate.candidate_name.split(/\s+/).slice(0, 2).map(word => word[0]).join("") || "?"}</div><Link href={`/recruiter/applicants/${candidate.id}`} className="mt-3 flex items-start gap-2 font-semibold hover:text-primary">{candidate.candidate_name}<ArrowUpRight className="mt-0.5 size-4 shrink-0" /></Link><p className="mt-1 truncate text-xs font-normal text-muted-foreground">{candidate.profile.headline || candidate.profile.current_position || "Applicant"}</p><div className="mt-3"><StatusBadge status={candidate.status} /></div></th>)}</tr></thead>
          <tbody key={view} className="comparison-content">
            {view === "Overview" && <>
              {row("Overall match", candidate => candidate.assessment ? <><div className="flex items-baseline gap-1"><span className="text-3xl font-semibold tabular-nums">{candidate.assessment.overall_score}</span><span className="text-xs text-muted-foreground">/ 100</span></div><progress aria-label={`${candidate.candidate_name} overall match`} max={100} value={candidate.assessment.overall_score} className="mt-3 h-1.5 w-full" />{candidate.assessment_stale && <p className="mt-3 flex gap-2 text-xs text-amber-700 dark:text-amber-300"><TriangleAlert className="size-4 shrink-0" />Outdated assessment. Job requirements changed.</p>}<p className="mt-3 text-xs leading-5 text-muted-foreground">{candidate.assessment.summary}</p></> : <Empty text="Not assessed yet" />)}
              {row("Skill match", candidate => <Metric value={candidate.assessment?.breakdown.skills} />)}
              {row("Experience", candidate => <><p className="font-semibold">{candidate.assessment ? `${candidate.assessment.years_experience} years` : "Not assessed"}</p><Excerpts items={candidate.resume_sections.experience} /></>, `Role minimum: ${data.job.requirements?.min_years_experience ?? 0} years`)}
              {row("Education", candidate => <Excerpts items={candidate.resume_sections.education} />, data.job.requirements?.education || "No education requirement specified")}
              {row("Projects", candidate => <Excerpts items={candidate.resume_sections.projects} />)}
              {row("Missing / weak requirements", candidate => <Items items={candidate.assessment?.gaps || []} empty="No assessment gaps recorded" />)}
              {row("Interview progress", candidate => <InterviewSummary candidate={candidate} />)}
            </>}
            {view === "Skills & gaps" && <>
              {([...(data.job.requirements?.must_have_skills || []).map(skill => ({ skill, kind: "Required" })), ...(data.job.requirements?.nice_to_have_skills || []).map(skill => ({ skill, kind: "Preferred" }))]).filter(({ skill }) => !differences || new Set(candidates.map(candidate => skillState(candidate, skill))).size > 1).map(({ skill, kind }, index) => <tr key={`${kind}-${index}`}><th scope="row">{skill}<p className="mt-1 text-xs font-normal text-muted-foreground">{kind}</p></th>{candidates.map(candidate => { const state = skillState(candidate, skill); return <td key={candidate.id}><span className={`inline-flex items-center gap-2 text-sm ${state === "demonstrated" ? "text-emerald-700 dark:text-emerald-300" : state === "missing" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>{state === "demonstrated" ? <Check className="size-4" /> : <Minus className="size-4" />}{state === "demonstrated" ? "Demonstrated" : state === "listed" ? "Listed in resume" : state === "missing" ? "Not found in resume" : state}</span></td>; })}</tr>)}
              {row("Strengths", candidate => <Items items={candidate.assessment?.strengths || []} empty="No strengths recorded yet" />)}
              {row("Gaps to discuss", candidate => <Items items={candidate.assessment?.gaps || []} empty="No gaps recorded yet" />)}
            </>}
            {view === "Resume evidence" && <>
              {row("Verified quotations", candidate => candidate.assessment?.evidence?.length ? <div className="space-y-5">{candidate.assessment.evidence.map((item, index) => <div key={index}><p className="mb-2 text-xs font-semibold">{item.claim}</p><blockquote className="border-l-2 border-primary/40 pl-3 text-sm leading-6 text-muted-foreground">{item.quote}</blockquote></div>)}</div> : <Empty text="No verified quotations recorded" />)}
              {row("Submitted resume", candidate => <><button className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => downloadFile(`/api/recruiter/applicants/${candidate.id}/resume`, candidate.resume_name).catch(error => toast.error(error.message))}><Download className="size-4" />Download</button><details className="mt-4"><summary className="cursor-pointer break-all text-xs font-medium text-primary">{candidate.resume_name}</summary><pre className="mt-4 whitespace-pre-wrap break-words font-sans text-xs leading-6">{candidate.resume_text}</pre></details></>)}
            </>}
            {view === "Interviews" && <>
              {row("Application status", candidate => <StatusBadge status={candidate.status} />)}
              {row("Interview rounds", candidate => <InterviewSummary candidate={candidate} />)}
              {row("Interview feedback", candidate => <div className="space-y-5">{candidate.interviews.filter(round => round.feedback).map(round => <div key={round.id}><p className="mb-2 font-semibold">{round.title}</p><p className="whitespace-pre-wrap text-sm leading-6">{round.feedback?.notes}</p><dl className="mt-3 grid grid-cols-2 gap-2 text-xs">{Object.entries(round.feedback || {}).filter(([key]) => ["technical", "problem_solving", "communication", "role_fit"].includes(key)).map(([key, value]) => <div key={key}><dt className="capitalize text-muted-foreground">{key.replaceAll("_", " ")}</dt><dd className="mt-1 font-medium">{String(value)} / 10</dd></div>)}</dl></div>)}{!candidate.interviews.some(round => round.feedback) && <Empty text="No interview feedback yet" />}</div>)}
            </>}
          </tbody>
        </table>
      </div><div className="shrink-0 border-t px-5 py-3 text-xs text-muted-foreground sm:px-7">Resume sections are verbatim excerpts. An absent section or skill is not proof that a candidate lacks the qualification.</div>
    </>}
  </DialogContent></Dialog>;
}

function Empty({ text }: { text: string }) { return <p className="text-sm leading-6 text-muted-foreground">{text}</p>; }
function Metric({ value }: { value?: number | null }) { return <p className="font-semibold tabular-nums">{value == null ? "Not assessed" : `${value} / 100`}</p>; }
function Excerpts({ items }: { items: string[] }) { return items.length ? <div className="mt-3 space-y-3">{items.map((item, index) => <p key={index} className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{item}</p>)}</div> : <Empty text="No labeled section found. Full resume is available under Resume evidence." />; }
function Items({ items, empty }: { items: string[]; empty: string }) { return items.length ? <ul className="list-disc space-y-2 pl-4 text-sm leading-6">{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <Empty text={empty} />; }
function InterviewSummary({ candidate }: { candidate: ComparedCandidate }) { return candidate.interviews.length ? <ul className="space-y-3">{candidate.interviews.map(round => <li key={round.id}><p className="text-sm font-medium">{round.title}</p><p className="mt-1 text-xs capitalize text-muted-foreground">{round.status.replaceAll("_", " ")}{round.scheduled_at ? ` · ${new Date(round.scheduled_at).toLocaleDateString()}` : ""}</p></li>)}</ul> : <Empty text="No interviews scheduled" />; }
