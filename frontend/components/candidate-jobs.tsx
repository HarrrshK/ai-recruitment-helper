"use client";
import Link from "next/link";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, ArrowRight, BriefcaseBusiness, Search } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useFetch } from "@/lib/use-fetch";
import { postJson } from "@/lib/api";
import type { Job } from "@/lib/types";
import type { Application, Resume } from "@/lib/portal";
import { dateLabel } from "@/lib/portal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button, buttonVariants } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { LoadingPortal, PortalHeading } from "@/components/portal-shared";

export function CandidateJobs() {
  const { state, reload } = useFetch<Job[]>("/api/portal/jobs");
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [experience, setExperience] = useState("all");
  const [sort, setSort] = useState("newest");
  const base = user?.role === "candidate" ? "/candidate/jobs" : "/careers";
  const jobs = state.status === "ready" ? state.data.filter(job => `${job.title} ${job.brief} ${job.requirements?.must_have_skills.join(" ") || ""}`.toLowerCase().includes(search.toLowerCase()) && (experience === "all" || (job.requirements?.min_years_experience ?? 0) <= Number(experience))).sort((a, b) => sort === "title" ? a.title.localeCompare(b.title) : b.id - a.id) : [];
  return <><PortalHeading title="Find your next role" description="Open opportunities, ready for your next step." />
    <div className="mb-6 flex flex-wrap items-end gap-3 border-y py-5">
      <div className="min-w-48 flex-1 space-y-2"><Label htmlFor="job-search">Title or skill</Label><div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input id="job-search" placeholder="Search jobs" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div></div>
      <div className="space-y-2"><Label htmlFor="experience-filter">Experience</Label><select id="experience-filter" value={experience} onChange={e => setExperience(e.target.value)} className="h-8 rounded-md border bg-background px-3 text-sm"><option value="all">Any experience</option><option value="0">Entry level</option><option value="2">Up to 2 years</option><option value="5">Up to 5 years</option></select></div>
      <div className="space-y-2"><Label htmlFor="sort-jobs">Sort by</Label><select id="sort-jobs" value={sort} onChange={e => setSort(e.target.value)} className="h-8 rounded-md border bg-background px-3 text-sm"><option value="newest">Newest first</option><option value="title">Job title</option></select></div>
    </div>
    {state.status === "loading" ? <LoadingPortal /> : state.status === "error" ? <ErrorState message={state.message} onRetry={reload} /> : <><p className="mb-4 text-sm text-muted-foreground">{jobs.length} open {jobs.length === 1 ? "role" : "roles"}</p>{!jobs.length ? <div className="py-16 text-center"><BriefcaseBusiness className="mx-auto mb-4 size-8 text-muted-foreground" /><h2 className="font-semibold">No matching jobs</h2><p className="mt-2 text-sm text-muted-foreground">Try a different search or check back for new openings.</p></div> : <div className="divide-y border-t">{jobs.map(job => <article key={job.id} className="grid gap-4 py-6 sm:grid-cols-[1fr_auto]"><div className="min-w-0"><Link href={`${base}/${job.id}`} className="text-xl font-semibold hover:text-primary">{job.title}</Link><p className="mt-2 line-clamp-2 max-w-3xl text-sm leading-6 text-muted-foreground">{job.brief}</p><div className="mt-4 flex flex-wrap gap-2">{job.requirements?.must_have_skills.slice(0, 5).map(skill => <span key={skill} className="rounded border px-2 py-1 text-xs">{skill}</span>)}</div><p className="mt-3 text-xs text-muted-foreground">{job.requirements ? `${job.requirements.min_years_experience}+ years experience · ` : ""}Posted {dateLabel(job.created_at)}</p></div><Link href={`${base}/${job.id}`} className={`${buttonVariants({ variant: "outline" })} self-start`}>View job <ArrowRight className="size-4" /></Link></article>)}</div>}</>}
  </>;
}

export function CandidateJobDetail({ jobId }: { jobId: string }) {
  const { state, reload } = useFetch<Job>(`/api/portal/jobs/${jobId}`);
  const { user } = useAuth();
  if (state.status === "loading") return <LoadingPortal />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;
  const job = state.data;
  return <><Link href={user?.role === "candidate" ? "/candidate/jobs" : "/careers"} className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4" />All jobs</Link><PortalHeading title={job.title} description={`Posted ${dateLabel(job.created_at)}`} />
    <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_320px]"><section className="min-w-0 space-y-7 border-t pt-6"><div className="prose prose-sm max-w-none break-words dark:prose-invert"><ReactMarkdown>{job.markdown || job.brief}</ReactMarkdown></div>{job.requirements && <><div><h2 className="mb-3 text-lg font-semibold">Required skills</h2><div className="flex flex-wrap gap-2">{job.requirements.must_have_skills.map(s => <span key={s} className="rounded-md border px-3 py-1 text-sm">{s}</span>)}</div></div><div><h2 className="mb-3 text-lg font-semibold">Preferred skills</h2><p className="text-sm text-muted-foreground">{job.requirements.nice_to_have_skills.join(", ") || "None specified"}</p></div><p className="text-sm">Minimum experience: {job.requirements.min_years_experience} years</p>{job.requirements.education && <p className="text-sm">Education: {job.requirements.education}</p>}</>}</section>
      <aside className="border-t pt-6"><h2 className="mb-4 text-lg font-semibold">Your application</h2>{user?.role === "candidate" ? <ApplyForm jobId={job.id} /> : <><p className="mb-4 text-sm text-muted-foreground">Sign in as a candidate to apply.</p><Link href="/login?role=candidate" className={buttonVariants()}>Candidate login <ArrowRight className="size-4" /></Link></>}</aside>
    </div></>;
}
function ApplyForm({ jobId }: { jobId: number }) {
  const resumes = useFetch<Resume[]>("/api/portal/resumes");
  const applications = useFetch<Application[]>("/api/portal/applications");
  const [resumeId, setResumeId] = useState("");
  const [cover, setCover] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  if (resumes.state.status === "loading" || applications.state.status === "loading") return <LoadingPortal />;
  if (resumes.state.status === "error") return <ErrorState message={resumes.state.message} onRetry={resumes.reload} />;
  if (applications.state.status === "error") return <ErrorState message={applications.state.message} onRetry={applications.reload} />;
  const existing = applications.state.data.find(a => a.job_id === jobId);
  if (existing) return <><p className="mb-4 text-sm text-muted-foreground">You have already applied for this role.</p><Link href={`/candidate/applications/${existing.id}`} className={buttonVariants()}>View application <ArrowRight className="size-4" /></Link></>;
  if (!resumes.state.data.length) return <><p className="mb-4 text-sm text-muted-foreground">Add a resume before submitting your application.</p><Link href="/candidate/resumes" className={buttonVariants()}>Upload a resume <ArrowRight className="size-4" /></Link></>;
  async function apply(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { const app = await postJson<Application>("/api/portal/applications", { job_id: jobId, resume_id: Number(resumeId), cover_letter: cover }); toast.success("Application submitted"); router.push(`/candidate/applications/${app.id}`); }
    catch (error) { toast.error((error as Error).message); setBusy(false); }
  }
  return <form onSubmit={apply} className="space-y-5"><div className="space-y-2"><Label htmlFor="apply-resume">Resume</Label><select id="apply-resume" required value={resumeId} onChange={e => setResumeId(e.target.value)} className="h-10 w-full min-w-0 rounded-md border bg-background px-2 text-sm"><option value="">Select a resume</option>{resumes.state.data.map(r => <option key={r.id} value={r.id}>{r.filename}</option>)}</select><Link href="/candidate/resumes" className="text-xs text-primary hover:underline">Manage resumes</Link></div><div className="space-y-2"><Label htmlFor="cover-letter">Cover letter (optional)</Label><Textarea id="cover-letter" rows={6} maxLength={5000} value={cover} onChange={e => setCover(e.target.value)} /></div><Button type="submit" disabled={busy || !resumeId} className="w-full">{busy ? "Submitting..." : "Submit application"}<ArrowRight className="size-4" /></Button></form>;
}
