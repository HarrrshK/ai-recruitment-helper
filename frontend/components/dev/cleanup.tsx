"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Eye, Pause, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, postJson, putJson } from "@/lib/api";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/lib/auth-context";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, LoadView, selectClass, TableWrap } from "./shared";

type Selection = { groups?: string[]; full_reset?: boolean; user_id?: number; company_id?: number; job_id?: number };
type Preview = { token: string; confirmation: string; counts: Record<string, number>; total: number; retained_staff: number; detached_memberships: Record<string, number[]>; expires_at: string };

export function MaintenanceBanner() {
  const query = useFetch<{ enabled: boolean }>("/api/dev/maintenance");
  const { update, reload } = query;
  useEffect(() => {
    let active = true;
    const timer = setInterval(() => { void apiFetch<{ enabled: boolean }>("/api/dev/maintenance").then(value => { if (active) update(() => value); }).catch(() => {}); }, 15000);
    window.addEventListener("maintenance-changed", reload);
    return () => { active = false; clearInterval(timer); window.removeEventListener("maintenance-changed", reload); };
  }, [update, reload]);
  if (query.state.status !== "ready" || !query.state.data.enabled) return null;
  return <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-400/40 bg-amber-400/15 px-5 py-3 text-sm"><span>Workspace paused for maintenance</span><Link href="/dev/database" className="underline">Manage maintenance</Link></div>;
}

export function CleanupConfirmation({ selection, onDone }: { selection: Selection; onDone?: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [password, setPassword] = useState(""), [reason, setReason] = useState(""), [confirmation, setConfirmation] = useState("");
  const [backup, setBackup] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <div className="space-y-5">
    <Button variant="outline" disabled={busy} onClick={async () => { setBusy(true); setError(""); setPreview(null); setConfirmation(""); setPassword(""); setBackup(false); try { setPreview(await postJson<Preview>("/api/dev/cleanup/preview", selection)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><Eye className="size-4" />Preview deletion</Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {preview && <form className="space-y-5 border-t pt-5" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError("");
      try { const result = await postJson<{ total: number; maintenance: boolean }>("/api/dev/cleanup/execute", { token: preview.token, confirmation, password, reason, backup_confirmed: backup }); toast.success(`${result.total} records permanently deleted${result.maintenance ? ". Workspace remains paused." : ""}`); setPreview(null); setPassword(""); onDone?.(); }
      catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}>
      <h3 className="text-lg font-semibold">Deletion impact: {preview.total} records</h3>
      <TableWrap><table><thead><tr><th>Table</th><th>Records to delete</th></tr></thead><tbody>{Object.entries(preview.counts).map(([name, count]) => <tr key={name}><td>{name}</td><td>{count}</td></tr>)}</tbody></table></TableWrap>
      <p className="text-sm text-muted-foreground">Includes dependent records. {preview.retained_staff} staff accounts and audit history are retained. Preview expires at {new Date(preview.expires_at).toLocaleTimeString()}.</p>
      {Object.keys(preview.detached_memberships).length > 0 && <p className="text-sm text-amber-700 dark:text-amber-300">Retained account links will be removed: {Object.entries(preview.detached_memberships).map(([field, ids]) => `${field}: ${ids.map(id => `#${id}`).join(", ")}`).join("; ")}</p>}
      <Field id="cleanup-reason" label="Deletion reason"><Input id="cleanup-reason" required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <Field id="cleanup-password" label="Your administrator password"><PasswordInput id="cleanup-password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></Field>
      <Field id="cleanup-confirmation" label={`Type ${preview.confirmation}`}><Input id="cleanup-confirmation" required autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></Field>
      <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={backup} onChange={e => setBackup(e.target.checked)} />I have a backup or accept permanent data loss. This action cannot be undone.</label>
      <Button type="submit" variant="destructive" disabled={busy || !preview.total || !backup || confirmation !== preview.confirmation || reason.trim().length < 3 || !password}><Trash2 className="size-4" />{busy ? "Deleting..." : "Permanently delete"}</Button>
    </form>}
  </div>;
}

function MaintenanceControl() {
  const query = useFetch<{ enabled: boolean; active_requests: number }>("/api/dev/maintenance");
  const [password, setPassword] = useState(""), [reason, setReason] = useState(""), [busy, setBusy] = useState(false);
  return <LoadView {...query}>{status => <form className="space-y-4 border-y py-6" onSubmit={async e => { e.preventDefault(); setBusy(true); try { await putJson("/api/dev/maintenance", { enabled: !status.enabled, password, reason }); setPassword(""); query.reload(); window.dispatchEvent(new Event("maintenance-changed")); toast.success(status.enabled ? "Workspace resumed" : "Maintenance enabled"); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">Workspace maintenance</h3><span className={status.enabled ? "text-amber-600 dark:text-amber-300" : "text-emerald-600 dark:text-emerald-300"}>{status.enabled ? "Paused" : "Live"}</span></div>
    <p className="text-sm text-muted-foreground">Bulk deletion requires a paused workspace. Candidate and recruiter requests are blocked; administrator access remains available.</p>
    <div className="grid gap-4 sm:grid-cols-2"><Field id="maintenance-reason" label="Maintenance reason"><Input id="maintenance-reason" required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field><Field id="maintenance-password" label="Administrator password"><PasswordInput id="maintenance-password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></Field></div>
    <Button disabled={busy} type="submit" variant="outline">{status.enabled ? <Play className="size-4" /> : <Pause className="size-4" />}{status.enabled ? "Resume workspace" : "Pause workspace"}</Button>
  </form>}</LoadView>;
}

export function DataManagement({ onChanged }: { onChanged?: () => void }) {
  const { user } = useAuth();
  const options = useFetch<{ groups: string[]; preserved: string[] }>("/api/dev/cleanup/options");
  const [mode, setMode] = useState("categories"), [groups, setGroups] = useState<string[]>([]), [id, setId] = useState("");
  if (user?.role !== "superadmin") return <section className="border-t pt-6"><h2 className="text-xl font-semibold">Database administration</h2><p className="mt-3 text-sm text-muted-foreground">Bulk cleanup and workspace maintenance require superadmin access. Individual user deletion is available in Users & access.</p></section>;
  const selection: Selection = mode === "all" ? { full_reset: true } : mode === "categories" ? { groups } : { [mode === "company" ? "company_id" : "job_id"]: Number(id) };
  const valid = mode === "all" || (mode === "categories" ? groups.length > 0 : Number.isInteger(Number(id)) && Number(id) > 0);
  return <section className="space-y-6 border-t pt-7"><h2 className="flex items-center gap-2 text-xl font-semibold"><AlertTriangle className="size-5 text-destructive" />Database administration</h2><MaintenanceControl /><div className="space-y-5"><h3 className="text-lg font-semibold text-destructive">Danger zone</h3><Field id="cleanup-scope" label="Deletion scope"><select id="cleanup-scope" className={selectClass} value={mode} onChange={e => setMode(e.target.value)}><option value="categories">Selected categories</option><option value="company">One company and dependent records</option><option value="job">One job and dependent records</option><option value="all">Reset all application data</option></select></Field>
    <LoadView {...options}>{data => <>{mode === "categories" && <fieldset className="grid grid-cols-2 gap-4 md:grid-cols-3"><legend className="mb-3 text-sm font-medium">Categories</legend>{data.groups.map(group => <label key={group} className="flex items-center gap-2 text-sm capitalize"><input type="checkbox" checked={groups.includes(group)} onChange={e => setGroups(e.target.checked ? [...groups, group] : groups.filter(value => value !== group))} />{group}</label>)}</fieldset>}<p className="text-sm text-muted-foreground">Always retained: {data.preserved.join(", ")}. This database reset does not remove disk caches; use Flush cache separately.</p></>}</LoadView>
    {["company", "job"].includes(mode) && <Field id="cleanup-record" label={mode === "company" ? "Company ID" : "Job ID"}><Input id="cleanup-record" className="max-w-xs" type="number" min={1} value={id} onChange={e => setId(e.target.value)} /></Field>}
    {valid && <CleanupConfirmation key={JSON.stringify(selection)} selection={selection} onDone={onChanged} />}
  </div></section>;
}
