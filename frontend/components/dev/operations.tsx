"use client";

import Link from "next/link";
import { useState } from "react";
import { Activity, ArrowLeft, ArrowRight, Download, Eye, FlaskConical, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { downloadFile, postJson } from "@/lib/api";
import { useFetch } from "@/lib/use-fetch";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CleanupConfirmation, MaintenanceControl } from "./cleanup";
import { DevHeading, Field, LoadView, selectClass, TableWrap } from "./shared";

type DataRow = Record<string, unknown> & { record_id: number; data_kind: string };
type Listing = { rows: DataRow[]; total: number; limit: number };
type Footprint = { record: DataRow; parents: Record<string, unknown>; related: Record<string, { rows: DataRow[]; total?: number }>; audit: unknown[]; limitations: string[] };
type Selection = { action: string; resource?: string; record_id?: number; value?: string; test_only?: boolean; job?: Record<string, unknown> };
const resources = ["users", "companies", "jobs", "applications", "resumes", "candidates", "profiles", "matches", "interviews", "interview-simulations", "panel-reviews", "qa", "messages", "outreach", "ai-runs", "ai-errors", "tasks"];
const endpoint = "/api/dev/operations";

function Readable({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">Not recorded</span>;
  if (typeof value !== "object") return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
  if (Array.isArray(value)) return value.length ? <ul className="space-y-3">{value.map((item, i) => <li key={i} className="border-l-2 pl-3"><Readable value={item} /></li>)}</ul> : <span className="text-muted-foreground">None</span>;
  return <dl className="space-y-3">{Object.entries(value).map(([key, item]) => <div key={key} className="grid min-w-0 gap-1 sm:grid-cols-[160px_minmax(0,1fr)]"><dt className="break-words text-muted-foreground">{key.replaceAll("_", " ")}</dt><dd className="min-w-0"><Readable value={item} /></dd></div>)}</dl>;
}

export function PlatformOperations() {
  const { user } = useAuth();
  if (user?.role !== "superadmin") return <section role="alert" className="border-y py-8"><h1 className="text-xl font-semibold">Superadmin access required</h1><Link href="/dev/llm" className="mt-4 inline-block underline">Return to developer tools</Link></section>;
  return <Console />;
}

function Console() {
  const [tab, setTab] = useState("Overview");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [revision, setRevision] = useState(0);
  return <>
    <DevHeading title="Platform operations" label="Superadmin" />
    <nav aria-label="Platform sections" className="flex gap-1 overflow-x-auto border-b">{["Overview", "Records", "AI operations", "Sessions", "Health & integrity", "Test data", "Danger zone"].map(name => <button key={name} className={`shrink-0 border-b-2 px-3 py-3 text-sm ${tab === name ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground"}`} aria-current={tab === name ? "page" : undefined} onClick={() => setTab(name)}>{name}</button>)}</nav>
    <div key={`${tab}:${revision}`}>
      {tab === "Overview" && <Overview />}
      {tab === "Records" && <Records onAction={setSelection} />}
      {tab === "AI operations" && <><div className="mb-6 flex flex-wrap gap-4"><Link className="underline" href="/dev/llm">Models, prompts & telemetry</Link><Link className="underline" href="/dev/evaluation">Evaluation & benchmarks</Link></div><Records initialResource="ai-runs" onAction={setSelection} /></>}
      {tab === "Sessions" && <><Report path="sessions" /><div className="mt-6 flex flex-wrap gap-3"><Link href="/dev/users" className={buttonVariants({ variant: "outline" })}>Individual session revocation</Link><Button variant="outline" onClick={() => setSelection({ action: "revoke_all_sessions" })}>Revoke other users&apos; sessions</Button></div></>}
      {tab === "Health & integrity" && <div className="space-y-8"><section><h2 className="mb-5 text-lg font-semibold">Service health & safe configuration</h2><Report path="health" /></section><section className="border-t pt-6"><h2 className="mb-5 text-lg font-semibold">Integrity checks</h2><Report path="integrity" /></section><Link href="/dev/database" className="inline-block underline">Table counts, index maintenance & cache tools</Link></div>}
      {tab === "Test data" && <TestData onAction={setSelection} />}
      {tab === "Danger zone" && <><MaintenanceControl /><section className="space-y-5 border-t border-destructive/30 pt-6"><h2 className="text-lg font-semibold text-destructive">Controlled platform operations</h2><div className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => setSelection({ action: "test_reset", test_only: true })}><Trash2 className="size-4" />Reset test environment</Button><Button variant="outline" onClick={() => setSelection({ action: "test_ai", test_only: true })}>Clear test AI data</Button><Button variant="outline" onClick={() => setSelection({ action: "registrations", value: "disabled" })}>Disable new registrations</Button><Button variant="outline" onClick={() => setSelection({ action: "registrations", value: "enabled" })}>Enable new registrations</Button></div><Link href="/dev/database" className="inline-block underline">Existing full-platform cleanup controls</Link></section></>}
    </div>
    <Dialog open={Boolean(selection)} onOpenChange={open => { if (!open) setSelection(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Review platform operation</DialogTitle><DialogDescription>{selection?.action.replaceAll("_", " ")} {selection?.resource} {selection?.record_id ? `#${selection.record_id}` : ""} {selection?.value}</DialogDescription></DialogHeader>{selection && <CleanupConfirmation key={JSON.stringify(selection)} selection={selection} endpoint={endpoint} operation onDone={() => { setSelection(null); setRevision(r => r + 1); }} />}</DialogContent></Dialog>
  </>;
}

function Overview() {
  const query = useFetch<{ counts: Record<string, number>; maintenance: boolean; registrations_enabled: boolean; marked_records: number }>(`${endpoint}/overview`);
  return <LoadView {...query}>{data => <><div className="mb-6 flex flex-wrap gap-6 border-y py-4 text-sm"><span>Workspace: <strong>{data.maintenance ? "Maintenance" : "Live"}</strong></span><span>Registrations: <strong>{data.registrations_enabled ? "Enabled" : "Disabled"}</strong></span><span>Marked TEST/DEMO records: <strong>{data.marked_records}</strong></span></div><dl className="grid grid-cols-2 gap-x-6 sm:grid-cols-3 xl:grid-cols-5">{Object.entries(data.counts).map(([name, count]) => <div key={name} className="border-b py-5"><dt className="text-sm capitalize text-muted-foreground">{name.replaceAll("_", " ").replaceAll("-", " ")}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{count.toLocaleString()}</dd></div>)}</dl><div className="mt-8 flex flex-wrap gap-4"><Link href="/dev/users" className={buttonVariants({ variant: "outline" })}>Users & permissions</Link><Link href="/dev/companies" className={buttonVariants({ variant: "outline" })}>Company administration</Link><Link href="/dev/audit" className={buttonVariants({ variant: "outline" })}><ShieldCheck className="size-4" />Audit history</Link></div></>}</LoadView>;
}

function Report({ path }: { path: string }) {
  const query = useFetch<Record<string, unknown>>(`${endpoint}/${path}`);
  return <LoadView {...query}>{data => <div className="text-sm"><Readable value={data} /></div>}</LoadView>;
}

function Records({ initialResource = "users", onAction }: { initialResource?: string; onAction: (selection: Selection) => void }) {
  const [resource, setResource] = useState(initialResource), [q, setQ] = useState(""), [role, setRole] = useState(""), [status, setStatus] = useState(""), [kind, setKind] = useState("ALL"), [company, setCompany] = useState(""), [since, setSince] = useState(""), [until, setUntil] = useState("");
  const [offset, setOffset] = useState(0), [selected, setSelected] = useState<number | null>(null);
  const params = new URLSearchParams({ q, role, status, kind, offset: String(offset) });
  if (company) params.set("company_id", company);
  if (since) params.set("since", `${since}T00:00:00Z`);
  if (until) params.set("until", `${until}T23:59:59Z`);
  const query = useFetch<Listing>(`${endpoint}/records/${resource}?${params}`);
  if (selected !== null) return <RecordDetail key={`${resource}:${selected}`} resource={resource} id={selected} onBack={() => { setSelected(null); query.reload(); }} onAction={onAction} />;
  return <div className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field id="ops-resource" label="Resource"><select id="ops-resource" className={`${selectClass} w-full`} value={resource} onChange={e => { setResource(e.target.value); setOffset(0); setRole(""); setStatus(""); }}>{resources.map(name => <option key={name}>{name}</option>)}</select></Field>
      <Field id="ops-search" label="ID, name or email"><div className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input id="ops-search" className="pl-9" value={q} onChange={e => { setQ(e.target.value); setOffset(0); }} /></div></Field>
      <Field id="ops-kind" label="Data classification"><select id="ops-kind" className={`${selectClass} w-full`} value={kind} onChange={e => { setKind(e.target.value); setOffset(0); }}>{["ALL", "REAL", "TEST", "DEMO"].map(name => <option key={name}>{name}</option>)}</select></Field>
      <Field id="ops-company" label="Company ID"><Input id="ops-company" type="number" min={1} value={company} onChange={e => { setCompany(e.target.value); setOffset(0); }} /></Field>
      {resource === "users" && <Field id="ops-role" label="Role"><select id="ops-role" className={`${selectClass} w-full`} value={role} onChange={e => { setRole(e.target.value); setOffset(0); }}><option value="">All roles</option>{["candidate", "recruiter", "developer", "superadmin"].map(name => <option key={name}>{name}</option>)}</select></Field>}
      <Field id="ops-status" label="Status"><Input id="ops-status" value={status} placeholder={resource === "users" ? "active / disabled" : "Any status"} onChange={e => { setStatus(e.target.value); setOffset(0); }} /></Field>
      <Field id="ops-since" label="Created from"><Input id="ops-since" type="date" value={since} onChange={e => { setSince(e.target.value); setOffset(0); }} /></Field>
      <Field id="ops-until" label="Created through"><Input id="ops-until" type="date" value={until} onChange={e => { setUntil(e.target.value); setOffset(0); }} /></Field>
    </div>
    <LoadView {...query}>{data => <><div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{data.total} records</p><Button aria-label="Refresh records" title="Refresh records" variant="ghost" size="icon" onClick={query.reload}><RefreshCw /></Button></div><TableWrap><table className="w-full text-left text-sm"><thead><tr><th>ID</th><th>Record</th><th>State</th><th>Data</th><th>Created</th><th><span className="sr-only">Inspect</span></th></tr></thead><tbody>{data.rows.map(row => <tr key={row.record_id}><td>#{row.record_id}</td><td className="max-w-xs break-words"><span className="font-medium">{String(row.full_name || row.name || row.title || row.filename || row.job_title || row.agent || row.kind || resource)}</span>{row.email ? <p className="text-muted-foreground">{String(row.email)}</p> : null}</td><td>{String(row.status || row.role || (row.disabled === true ? "disabled" : ""))}</td><td><span className={`rounded border px-2 py-1 text-xs ${row.data_kind === "REAL" ? "" : "border-amber-500/40 text-amber-700 dark:text-amber-300"}`}>{row.data_kind}</span></td><td className="whitespace-nowrap">{row.created_at ? new Date(String(row.created_at)).toLocaleDateString() : "Not recorded"}</td><td><Button size="icon" variant="ghost" aria-label={`Inspect ${resource} ${row.record_id}`} title="Inspect record" onClick={() => setSelected(row.record_id)}><Eye /></Button></td></tr>)}</tbody></table>{!data.rows.length && <p className="p-8 text-center text-muted-foreground">No matching records.</p>}</TableWrap><div className="flex items-center gap-3"><Button variant="outline" size="icon" aria-label="Previous page" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}><ArrowLeft /></Button><span className="text-sm">Page {Math.floor(offset / 50) + 1}</span><Button variant="outline" size="icon" aria-label="Next page" disabled={offset + 50 >= data.total} onClick={() => setOffset(offset + 50)}><ArrowRight /></Button></div></>}</LoadView>
  </div>;
}

function RecordDetail({ resource, id, onBack, onAction }: { resource: string; id: number; onBack: () => void; onAction: (selection: Selection) => void }) {
  const query = useFetch<Footprint>(`${endpoint}/records/${resource}/${id}`);
  const [kind, setKind] = useState("TEST"), [status, setStatus] = useState(""), [reason, setReason] = useState(""), [busy, setBusy] = useState(false);
  const action = (name: string, value?: string) => onAction({ action: name, resource, record_id: id, value });
  return <div className="space-y-6"><Button variant="ghost" onClick={onBack}><ArrowLeft className="size-4" />Back to records</Button><h2 className="text-xl font-semibold capitalize">{resource} #{id}</h2>
    <LoadView {...query}>{data => <>
      <section className="space-y-5 border-y py-5 text-sm"><Readable value={data.record} /></section>
      <div className="flex flex-wrap gap-3">{resource === "users" && <Link href="/dev/users" className={buttonVariants({ variant: "outline" })}>Edit profile, access & password</Link>}{resource === "companies" && <Link href="/dev/companies" className={buttonVariants({ variant: "outline" })}>Edit company & membership</Link>}{resource === "resumes" && <Button variant="outline" onClick={() => downloadFile(`${endpoint}/resumes/${id}/download`, String(data.record.filename)).catch(e => toast.error(e.message))}><Download className="size-4" />Download resume</Button>}</div>
      {Object.keys(data.parents).length > 0 && <details className="border-b pb-5"><summary className="cursor-pointer font-medium">Linked owner / job / company</summary><div className="mt-4 text-sm"><Readable value={data.parents} /></div></details>}
      {Object.entries(data.related).map(([name, group]) => <details key={name} className="border-b pb-5"><summary className="cursor-pointer font-medium">{name.replaceAll("_", " ")} ({group.total ?? group.rows.length})</summary><div className="mt-4 text-sm"><Readable value={group.rows} />{(group.total || 0) > group.rows.length && <p className="mt-3 text-muted-foreground">First 200 records shown. Use the resource browser for further records.</p>}</div></details>)}
      <details className="border-b pb-5"><summary className="cursor-pointer font-medium">Audit history</summary><div className="mt-4 text-sm"><Readable value={data.audit} /></div></details>
      {resource === "jobs" && <JobEditor row={data.record} onReview={job => onAction({ action: "edit_job", resource, record_id: id, job })} />}
      {["applications", "candidates", "resumes", "matches", "interviews"].includes(resource) && <form className="space-y-4 border-b pb-5" onSubmit={async e => { e.preventDefault(); setBusy(true); try { await postJson(`${endpoint}/records/${resource}/${id}/rerun`, { reason }); toast.success("Processing completed"); query.reload(); } catch (error) { toast.error((error as Error).message); } finally { setBusy(false); } }}><h3 className="font-semibold">{resource === "resumes" ? "Re-extract resume text" : resource === "matches" ? "Rebuild skill-gap roadmap" : "Re-run derived analysis"}</h3><Field id="rerun-reason" label="Processing reason"><Input id="rerun-reason" required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field><Button variant="outline" disabled={busy} type="submit"><Activity className="size-4" />{busy ? "Processing..." : "Run selected operation"}</Button></form>}
      <section className="space-y-5 border-b pb-5"><h3 className="font-semibold">Classification & administrative overrides</h3><div className="flex flex-wrap items-end gap-3"><Field id="mark-kind" label="Data classification"><select id="mark-kind" className={selectClass} value={kind} onChange={e => setKind(e.target.value)}>{["REAL", "TEST", "DEMO"].map(value => <option key={value}>{value}</option>)}</select></Field><Button variant="outline" onClick={() => action("label", kind)}>Review classification change</Button></div>
        {["jobs", "applications"].includes(resource) && <div className="flex flex-wrap items-end gap-3"><Field id="override-status" label="Administrative status"><select id="override-status" className={selectClass} value={status} onChange={e => setStatus(e.target.value)}><option value="">Choose status</option>{(resource === "jobs" ? ["draft", "ready", "closed"] : ["applied", "screened", "shortlisted", "interview", "offer", "hired", "rejected", "withdrawn"]).map(value => <option key={value}>{value}</option>)}</select></Field><Button variant="outline" onClick={() => action("status", status)}>Review status override</Button></div>}
      </section>
      <section className="space-y-4 border-b border-destructive/30 pb-6"><h3 className="font-semibold text-destructive">Record danger zone</h3><div className="flex flex-wrap gap-3">{["users", "companies", "jobs", "applications"].includes(resource) && <Button variant="outline" onClick={() => action("reset")}>Reset associated data</Button>}{["applications", "candidates", "interviews"].includes(resource) && <Button variant="outline" onClick={() => action("clear_ai")}>Clear derived AI data</Button>}<Button variant="outline" onClick={() => action("delete")}><Trash2 className="size-4" />Review permanent deletion</Button></div></section>
      <div className="space-y-2 text-xs text-muted-foreground">{data.limitations.map(text => <p key={text}>{text}</p>)}</div>
    </>}</LoadView>
  </div>;
}

function JobEditor({ row, onReview }: { row: DataRow; onReview: (job: Record<string, unknown>) => void }) {
  const description = row.description as { markdown?: string; requirements?: Record<string, unknown> } | null;
  const [title, setTitle] = useState(String(row.title)), [markdown, setMarkdown] = useState(description?.markdown || ""), [requirements, setRequirements] = useState(JSON.stringify(description?.requirements || {}, null, 2));
  return <details className="border-b pb-5"><summary className="cursor-pointer font-medium">Edit job definition</summary><form className="mt-5 space-y-4" onSubmit={e => { e.preventDefault(); try { onReview({ title, markdown, requirements: JSON.parse(requirements), brief: row.brief || "", location: row.location || "", work_mode: row.work_mode || "onsite", employment_type: row.employment_type || "full_time", status: row.status }); } catch { toast.error("Requirements must be valid JSON"); } }}><Field id="ops-job-title" label="Job title"><Input id="ops-job-title" required minLength={2} maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></Field><Field id="ops-job-markdown" label="Job description"><Textarea id="ops-job-markdown" rows={8} maxLength={30000} value={markdown} onChange={e => setMarkdown(e.target.value)} /></Field><Field id="ops-job-requirements" label="Structured requirements (JSON)"><Textarea id="ops-job-requirements" rows={10} value={requirements} onChange={e => setRequirements(e.target.value)} /></Field><Button variant="outline" type="submit">Review job changes</Button></form></details>;
}

function TestData({ onAction }: { onAction: (selection: Selection) => void }) {
  const [count, setCount] = useState(3), [kind, setKind] = useState("DEMO"), [reason, setReason] = useState(""), [busy, setBusy] = useState(false);
  return <div className="space-y-8"><form className="space-y-5" onSubmit={async e => { e.preventDefault(); setBusy(true); try { const result = await postJson<{ created: number; company_id: number }>(`${endpoint}/seed`, { candidates: count, kind, reason }); toast.success(`${result.created} records created in company #${result.company_id}`); } catch (error) { toast.error((error as Error).message); } finally { setBusy(false); } }}><h2 className="text-lg font-semibold">Seed an isolated workspace</h2><p className="text-sm text-muted-foreground">Fictional company, recruiter, candidates, binary resumes and applications. Seeded accounts start disabled with random passwords.</p><div className="grid gap-4 sm:grid-cols-2"><Field id="seed-count" label="Candidate count"><Input id="seed-count" type="number" min={1} max={20} required value={count} onChange={e => setCount(Number(e.target.value))} /></Field><Field id="seed-kind" label="Data classification"><select id="seed-kind" className={selectClass} value={kind} onChange={e => setKind(e.target.value)}><option>DEMO</option><option>TEST</option></select></Field></div><Field id="seed-reason" label="Seeding reason"><Input id="seed-reason" required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field><Button disabled={busy} type="submit"><FlaskConical className="size-4" />{busy ? "Creating..." : "Seed workspace"}</Button></form><section className="space-y-4 border-t pt-6"><h2 className="text-lg font-semibold">Test-only cleanup</h2><p className="text-sm text-muted-foreground">Unmarked records are REAL. Cleanup is refused if any dependent REAL record would be affected.</p><div className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => onAction({ action: "test_reset", test_only: true })}>Review test-data reset</Button><Button variant="outline" onClick={() => onAction({ action: "test_ai", test_only: true })}>Review AI test cleanup</Button><Link href="/dev/users" className={buttonVariants({ variant: "outline" })}>Create individual accounts</Link></div></section></div>;
}
