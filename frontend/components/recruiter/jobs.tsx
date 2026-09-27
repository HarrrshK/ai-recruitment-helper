"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight, CircleX, Pencil, Plus, Save, Search, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { useFetch } from "@/lib/use-fetch";
import { postJson, putJson } from "@/lib/api";
import { jobStatuses, type RecruiterJob } from "@/lib/recruiter";
import { dateLabel } from "@/lib/portal";
import { PortalHeading } from "@/components/portal-shared";
import { Field, LoadView, selectClass } from "@/components/recruiter/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function RecruiterJobs() {
  const query = useFetch<RecruiterJob[]>("/api/recruiter/jobs");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [closing, setClosing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  async function close(id: number) {
    setBusy(true);
    try { await postJson(`/api/recruiter/jobs/${id}/close`); setClosing(null); query.reload(); toast.success("Job closed to new applications"); }
    catch (error) { toast.error((error as Error).message); } finally { setBusy(false); }
  }
  return <><PortalHeading title="Jobs" description="Manage open roles, drafts and closed positions." action={<Link href="/recruiter/jobs/new" className={buttonVariants()}><Plus className="size-4" />Create job</Link>} />
    <div className="mb-6 flex flex-wrap gap-3 border-y py-5"><div className="relative min-w-48 flex-1"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="Search jobs" placeholder="Search job titles" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div><select aria-label="Job status" className={selectClass} value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option>{Object.entries(jobStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
    <LoadView {...query}>{jobs => { const filtered = jobs.filter(j => j.title.toLowerCase().includes(search.toLowerCase()) && (status === "all" || status === j.status)); return !filtered.length ? <p className="py-12 text-center text-muted-foreground">No jobs match this view.</p> : <div className="divide-y">{filtered.map(job => <article key={job.id} className="py-5"><div className="flex flex-wrap items-start justify-between gap-5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-3"><Link href={`/recruiter/jobs/${job.id}`} className="text-lg font-semibold hover:text-primary">{job.title}</Link><span className={`rounded-md px-2 py-1 text-xs ${job.status === "ready" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-muted text-muted-foreground"}`}>{jobStatuses[job.status]}</span></div><p className="mt-2 text-sm text-muted-foreground">{job.location || "Location not specified"} · {job.work_mode} · {job.employment_type.replaceAll("_", " ")}</p><p className="mt-2 text-xs text-muted-foreground">Created {dateLabel(job.created_at)}</p></div><div className="flex flex-wrap items-center gap-3"><Link href={`/recruiter/applicants?job=${job.id}`} className="text-sm font-medium text-primary">{job.applicants} applicants</Link><Link href={`/recruiter/jobs/${job.id}`} aria-label={`Edit ${job.title}`} title="Edit job" className={buttonVariants({ variant: "outline", size: "icon" })}><Pencil /></Link>{job.status !== "closed" && <Button variant="outline" size="icon" title="Close job" aria-label={`Close ${job.title}`} onClick={() => setClosing(job.id)}><CircleX /></Button>}<Link href={`/recruiter/applicants?job=${job.id}`} aria-label={`View applicants for ${job.title}`} title="View applicants" className={buttonVariants({ variant: "outline", size: "icon" })}><ArrowRight /></Link></div></div>{closing === job.id && <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4 text-sm"><p className="flex-1">Close this job to new applications? Existing applications will be retained.</p><Button variant="destructive" disabled={busy} onClick={() => close(job.id)}>Confirm close</Button><Button variant="outline" onClick={() => setClosing(null)}>Cancel</Button></div>}</article>)}</div>; }}</LoadView>
  </>;
}

export function RecruiterJobEditor({ jobId }: { jobId?: string }) {
  return jobId ? <ExistingJob jobId={jobId} /> : <JobForm />;
}
function ExistingJob({ jobId }: { jobId: string }) {
  const query = useFetch<RecruiterJob>(`/api/recruiter/jobs/${jobId}`);
  return <LoadView {...query}>{job => <JobForm initial={job} />}</LoadView>;
}
function JobForm({ initial }: { initial?: RecruiterJob }) {
  const [form, setForm] = useState({ title: initial?.title || "", brief: initial?.brief || "", markdown: initial?.markdown || "", location: initial?.location || "", work_mode: initial?.work_mode || "onsite", employment_type: initial?.employment_type || "full_time" });
  const [must, setMust] = useState(initial?.requirements?.must_have_skills.join(", ") || "");
  const [nice, setNice] = useState(initial?.requirements?.nice_to_have_skills.join(", ") || "");
  const [years, setYears] = useState(initial?.requirements?.min_years_experience ?? 0);
  const [education, setEducation] = useState(initial?.requirements?.education || "");
  const [duties, setDuties] = useState(initial?.requirements?.responsibilities.join("\n") || "");
  const [status, setStatus] = useState(initial?.status || "draft");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<{ markdown: string; requirements: NonNullable<RecruiterJob["requirements"]> } | null>(null);
  const router = useRouter();
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true);
    const requestedStatus = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") || status;
    const split = (value: string) => [...new Set(value.split(",").map(s => s.trim()).filter(Boolean))];
    const body = { ...form, status: requestedStatus, requirements: { must_have_skills: split(must), nice_to_have_skills: split(nice), min_years_experience: years, education: education || null, responsibilities: duties.split("\n").map(s => s.trim()).filter(Boolean) } };
    try { if (initial) await putJson(`/api/recruiter/jobs/${initial.id}`, body); else await postJson("/api/recruiter/jobs", body); toast.success(requestedStatus === "ready" ? "Job published" : "Job saved"); router.push("/recruiter/jobs"); }
    catch (error) { toast.error((error as Error).message); setBusy(false); }
  }
  async function generateProfile() {
    if (!form.title.trim()) { toast.error("Add a job title first"); return; }
    setGenerating(true);
    try { setGenerated(await postJson<{ markdown: string; requirements: NonNullable<RecruiterJob["requirements"]> }>("/api/recruiter/jobs/generate", { title: form.title, brief: form.brief })); }
    catch (error) { toast.error((error as Error).message); }
    finally { setGenerating(false); }
  }
  function useGenerated() {
    if (!generated) return;
    setForm({ ...form, markdown: generated.markdown });
    setMust(generated.requirements.must_have_skills.join(", "));
    setNice(generated.requirements.nice_to_have_skills.join(", "));
    setYears(generated.requirements.min_years_experience);
    setEducation(generated.requirements.education || "");
    setDuties(generated.requirements.responsibilities.join("\n"));
    setGenerated(null);
  }
  return <><Link href="/recruiter/jobs" className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4" />All jobs</Link><PortalHeading title={initial ? "Edit job" : "Create a job"} description={initial ? initial.title : "Define the role and the requirements candidates will be assessed against."} />
    <form onSubmit={save} className="max-w-4xl space-y-8"><section className="space-y-5 border-t pt-6"><h2 className="text-lg font-semibold">Role details</h2><div className="grid gap-5 sm:grid-cols-2"><Field id="job-title" label="Job title"><Input id="job-title" value={form.title} required minLength={2} maxLength={200} onChange={e => setForm({ ...form, title: e.target.value })} /></Field><Field id="job-location" label="Location"><Input id="job-location" value={form.location} maxLength={200} onChange={e => setForm({ ...form, location: e.target.value })} /></Field><Field id="job-mode" label="Work mode"><select id="job-mode" className={`${selectClass} w-full`} value={form.work_mode} onChange={e => setForm({ ...form, work_mode: e.target.value })}>{["onsite", "hybrid", "remote"].map(mode => <option key={mode} value={mode}>{mode[0].toUpperCase() + mode.slice(1)}</option>)}</select></Field><Field id="job-type" label="Employment type"><select id="job-type" className={`${selectClass} w-full`} value={form.employment_type} onChange={e => setForm({ ...form, employment_type: e.target.value })}>{["full_time", "part_time", "contract", "internship"].map(type => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></Field></div><Field id="job-summary" label="Short summary"><Textarea id="job-summary" rows={2} maxLength={3000} value={form.brief} onChange={e => setForm({ ...form, brief: e.target.value })} /></Field><div className="flex items-center justify-between gap-3"><label htmlFor="job-description" className="text-sm font-medium">Job description</label><Button type="button" variant="outline" size="sm" onClick={generateProfile} disabled={generating}><Sparkles className="size-4" />{generating ? "Generating..." : "Generate with AI"}</Button></div><Textarea id="job-description" rows={9} maxLength={30000} value={form.markdown} onChange={e => setForm({ ...form, markdown: e.target.value })} />{generated && <div className="space-y-3 border-l-2 border-primary pl-4"><p className="text-sm font-medium">Generated profile preview</p><p className="line-clamp-4 whitespace-pre-wrap text-sm text-muted-foreground">{generated.markdown}</p><div className="flex gap-2"><Button type="button" size="sm" onClick={useGenerated}>Use generated profile</Button><Button type="button" size="sm" variant="ghost" onClick={() => setGenerated(null)}>Discard</Button></div></div>}</section>
      <section className="space-y-5 border-t pt-6"><h2 className="text-lg font-semibold">Assessment requirements</h2>{initial && initial.applicants > 0 && <p className="text-sm text-muted-foreground">Changing the description or requirements marks earlier match scores as outdated until reassessed.</p>}<SkillPicker id="required-skills" label="Required skills" value={must} onChange={setMust} /><SkillPicker id="preferred-skills" label="Preferred skills" value={nice} onChange={setNice} /><div className="grid gap-5 sm:grid-cols-2"><Field id="minimum-years" label="Minimum experience (years)"><Input id="minimum-years" type="number" min={0} max={60} step={1} required value={years} onChange={e => setYears(Number(e.target.value))} /></Field><Field id="job-education" label="Education"><Input id="job-education" value={education} onChange={e => setEducation(e.target.value)} /></Field></div><Field id="responsibilities" label="Responsibilities (one per line)"><Textarea id="responsibilities" rows={4} value={duties} onChange={e => setDuties(e.target.value)} /></Field></section>
      <div className="flex flex-wrap items-end gap-3 border-t pt-6">{initial ? <><Field id="edit-status" label="Job status"><select id="edit-status" className={selectClass} value={status} onChange={e => setStatus(e.target.value as RecruiterJob["status"])}>{Object.entries(jobStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Button type="submit" disabled={busy}><Save className="size-4" />{busy ? "Saving..." : "Save changes"}</Button></> : <><Button type="submit" value="draft" variant="outline" disabled={busy}><Save className="size-4" />Save draft</Button><Button type="submit" value="ready" disabled={busy}><Send className="size-4" />{busy ? "Saving..." : "Publish job"}</Button></>}<Link href="/recruiter/jobs" className={buttonVariants({ variant: "ghost" })}>Cancel</Link></div>
    </form></>;
}

function SkillPicker({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState("");
  const skills = [...new Set(value.split(",").map(item => item.trim()).filter(Boolean))];
  function add() {
    const skill = draft.trim();
    if (skill && !skills.some(item => item.toLowerCase() === skill.toLowerCase())) onChange([...skills, skill].join(", "));
    setDraft("");
  }
  return <Field id={id} label={label}><div className="space-y-3"><div className="flex gap-2"><Input id={id} value={draft} placeholder="Add a skill" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); add(); } }} /><Button type="button" variant="outline" onClick={add} disabled={!draft.trim()}>Add</Button></div><div className="flex flex-wrap gap-2">{skills.map(skill => <span key={skill} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs">{skill}<button type="button" aria-label={`Remove ${skill}`} onClick={() => onChange(skills.filter(item => item !== skill).join(", "))}><X className="size-3" /></button></span>)}</div></div></Field>;
}
