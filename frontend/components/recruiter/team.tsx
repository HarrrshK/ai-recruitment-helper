"use client";
import { useState } from "react";
import { Copy, Save, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { useFetch } from "@/lib/use-fetch";
import { del, postJson, putJson } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Field, LoadView, selectClass } from "@/components/recruiter/shared";

type Member = { id: number; name: string; email: string; permissions: string[] };
type Invite = { id: number; email: string; expires_at: string; accepted_at: string | null };
const presets: Record<string, string[]> = { Recruiter: ["jobs.create", "jobs.edit", "applicants.review", "interviews.manage", "messages.send"], Interviewer: ["interviews.manage", "applicants.review"], Coordinator: ["interviews.manage", "messages.send"], "Company manager": ["jobs.create", "jobs.edit", "applicants.review", "interviews.manage", "messages.send", "company.edit"] };
function Access({ value, setValue, allowed }: { value: string[]; setValue: (value: string[]) => void; allowed: string[] }) {
  return <div className="space-y-3"><select aria-label="Permission preset" className={selectClass} value="" onChange={e => setValue(presets[e.target.value].filter(p => allowed.includes(p)))}><option value="" disabled>Choose role preset</option>{Object.keys(presets).map(role => <option key={role}>{role}</option>)}</select><div className="flex flex-wrap gap-4">{allowed.map(permission => <label key={permission} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.includes(permission)} onChange={e => setValue(e.target.checked ? [...value, permission] : value.filter(p => p !== permission))} />{permission}</label>)}</div></div>;
}
export function TeamManager() {
  const { user } = useAuth();
  const query = useFetch<{ members: Member[]; invites: Invite[] }>("/api/recruiter/company/team");
  const allowed = user?.permissions || [];
  const [email, setEmail] = useState(""), [days, setDays] = useState(7), [permissions, setPermissions] = useState<string[]>([]), [code, setCode] = useState("");
  const [editing, setEditing] = useState<Member | null>(null), [revoking, setRevoking] = useState<number | null>(null), [busy, setBusy] = useState(false);
  async function invite(e: React.FormEvent) { e.preventDefault(); setBusy(true); try { const result = await postJson<{ code: string }>("/api/recruiter/company/team/invites", { email, days, permissions }); setCode(result.code); query.reload(); toast.success("Invitation created"); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }
  return <section className="mt-8 space-y-6 border-t pt-6"><h2 className="text-xl font-semibold">Team & permissions</h2><form className="space-y-4" onSubmit={invite}><div className="grid gap-4 sm:grid-cols-2"><Field id="invite-email" label="Team member email"><Input id="invite-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} /></Field><Field id="invite-days" label="Invite validity (days)"><Input id="invite-days" type="number" min={1} max={30} value={days} onChange={e => setDays(Number(e.target.value))} /></Field></div><Access value={permissions} setValue={setPermissions} allowed={allowed} /><Button type="submit" disabled={busy}><UserPlus className="size-4" />Create invitation</Button></form>
    {code && <div className="space-y-3 border p-4"><p className="text-sm">Share this code securely with the invited person. No email has been sent.</p><code className="block break-all">{code}</code><Button variant="outline" onClick={() => navigator.clipboard.writeText(code).then(() => toast.success("Code copied")).catch(() => toast.error("Could not copy code"))}><Copy className="size-4" />Copy code</Button></div>}
    <LoadView {...query}>{data => <><div className="divide-y">{data.members.map(member => <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-medium">{member.name}</p><p className="break-all text-sm text-muted-foreground">{member.email}</p><p className="mt-2 text-xs text-muted-foreground">{member.permissions.join(", ") || "No delegated permissions"}</p></div><Button variant="outline" disabled={member.id === user?.id} onClick={() => setEditing({ ...member })}>Edit permissions</Button></div>)}</div><h3 className="font-semibold">Invitations</h3>{data.invites.map(invite => <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 text-sm"><span>{invite.email} · {invite.accepted_at ? "Accepted" : `Expires ${new Date(invite.expires_at.endsWith("Z") ? invite.expires_at : `${invite.expires_at}Z`).toLocaleDateString()}`}</span>{!invite.accepted_at && <Button variant="ghost" size="icon" title="Revoke invitation" aria-label={`Revoke invitation for ${invite.email}`} onClick={() => setRevoking(invite.id)}><X /></Button>}</div>)}</>}</LoadView>
    {editing && <section className="space-y-4 border p-4"><h3 className="font-semibold">Permissions for {editing.name}</h3><Access value={editing.permissions} setValue={permissions => setEditing({ ...editing, permissions })} allowed={allowed} /><Button disabled={busy} onClick={async () => { setBusy(true); try { await putJson(`/api/recruiter/company/team/${editing.id}/permissions`, { permissions: editing.permissions }); setEditing(null); query.reload(); toast.success("Permissions updated"); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }}><Save className="size-4" />Save permissions</Button><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></section>}
    <ConfirmDialog open={revoking !== null} onOpenChange={open => { if (!open) setRevoking(null); }} title="Revoke this invitation?" description="The invitation code will stop working. Existing members are not removed." confirmLabel="Revoke invitation" busy={busy} onConfirm={async () => { setBusy(true); try { await del(`/api/recruiter/company/team/invites/${revoking}`); setRevoking(null); query.reload(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }} />
  </section>;
}
