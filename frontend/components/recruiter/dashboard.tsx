"use client";
import Link from "next/link";
import { ArrowRight, CalendarDays, Plus, Users, BriefcaseBusiness, UserCheck, ClipboardCheck, FilePenLine } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import { formatDateTime, type RecruiterDashboard } from "@/lib/recruiter";
import { dateLabel, statusLabels } from "@/lib/portal";
import { PortalHeading, StatusBadge } from "@/components/portal-shared";
import { WorkspaceAvatar } from "@/components/workspace-shell";
import { LoadView } from "@/components/recruiter/shared";
import { buttonVariants } from "@/components/ui/button";

export function RecruiterDashboardView() {
  const query = useFetch<RecruiterDashboard>("/api/recruiter/dashboard");
  return <LoadView {...query}>{data => <>
    <PortalHeading title="Recruiter dashboard" description={data.company.name || "Your hiring activity at a glance."} action={<Link href="/recruiter/jobs/new" className={buttonVariants()}><Plus className="size-4" />Create job</Link>} />
    <div className="template-stats">{[
      { label: "Open jobs", count: data.open_jobs, href: "/recruiter/jobs", icon: BriefcaseBusiness, detail: "Currently accepting applications" },
      { label: "Applicants", count: data.applications, href: "/recruiter/applicants", icon: Users, detail: "Across your posted jobs" },
      { label: "Shortlisted", count: data.shortlisted, href: "/recruiter/applicants?status=shortlisted", icon: UserCheck, detail: "Selected for the next stage" },
      { label: "Awaiting assessment", count: data.pending_review, href: "/recruiter/applicants", icon: ClipboardCheck, detail: "Ready for your review" },
    ].map(({ label, count, href, icon: Icon, detail }) => <Link key={label} href={href} className="template-stat"><p className="template-stat-label">{label}<Icon size={16} /></p><p className="template-stat-value">{count}</p><p className="template-stat-foot">{detail}</p></Link>)}</div>
    <div className="template-overview"><div className="min-w-0">
      <section className="template-section"><div className="template-section-heading"><h2>Hiring pipeline</h2><Link href="/recruiter/applicants">View applicants <ArrowRight className="inline size-3" /></Link></div><dl className="template-pipeline">{Object.entries(data.stages).filter(([stage]) => !["rejected", "withdrawn"].includes(stage)).map(([stage, count]) => <div className="template-pipeline-step" key={stage}><dt>{statusLabels[stage] || stage}</dt><dd>{count}</dd></div>)}</dl></section>
      <section className="template-section"><div className="template-section-heading"><h2>Recent applicants</h2><Link href="/recruiter/applicants">View all</Link></div>{!data.recent_applicants.length ? <p className="py-8 text-sm text-muted-foreground">Applications will appear here once candidates apply to your jobs.</p> : <div className="template-table-wrap"><table className="template-table"><caption className="sr-only">Recent applicants for your jobs</caption><thead><tr><th scope="col">Candidate</th><th scope="col">Match</th><th scope="col">Status</th></tr></thead><tbody>{data.recent_applicants.map((a, index) => <tr key={a.id}><td><Link href={`/recruiter/applicants/${a.id}`} className="template-person"><WorkspaceAvatar name={a.candidate_name} className={`tone-${index % 4}`} /><div><p className="font-medium">{a.candidate_name}</p><p className="mt-1 text-xs text-muted-foreground">{a.job_title}</p><p className="mt-1 text-[10px] text-muted-foreground">{dateLabel(a.created_at)}</p></div></Link></td><td>{a.assessment ? <span className="template-match">{Math.round(a.assessment.overall_score)}%{a.assessment_stale && <span className="text-muted-foreground"> (outdated)</span>}</span> : <span className="text-muted-foreground">Pending</span>}</td><td><StatusBadge status={a.status} /></td></tr>)}</tbody></table></div>}</section>
    </div><div className="min-w-0">
      <section className="template-section"><div className="template-section-heading"><h2>Needs attention</h2></div><div className="template-insight"><ClipboardCheck size={18} /><div><h3>{data.pending_review} awaiting assessment</h3><p>Review candidate evidence and match information before progressing applications.</p><Link href="/recruiter/applicants">Review applicants <ArrowRight size={13} /></Link></div></div><div className="template-insight"><FilePenLine size={18} /><div><h3>{data.draft_jobs} draft jobs</h3><p>Review your job requirements before publishing.</p><Link href="/recruiter/jobs">Manage jobs <ArrowRight size={13} /></Link></div></div></section>
      <section className="template-section"><div className="template-section-heading"><h2><CalendarDays size={16} />Upcoming interviews</h2><Link href="/recruiter/interviews">View all</Link></div>{!data.upcoming_interviews.length ? <p className="py-4 text-sm text-muted-foreground">No interviews scheduled.</p> : data.upcoming_interviews.map(i => <Link href={`/recruiter/interviews/${i.id}`} key={i.id} className="template-interview"><WorkspaceAvatar name={i.candidate_name} className="tone-2" /><div><h3>{i.candidate_name}</h3><p>{i.title} · {i.job_title}</p><time>{formatDateTime(i.scheduled_at)}</time></div><ArrowRight className="ml-auto size-4 shrink-0 text-muted-foreground" /></Link>)}</section>
    </div></div>
  </>}</LoadView>;
}
