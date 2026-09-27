"use client";
import { useState } from "react";
import { KeyRound, LogOut, Plus, Save, Shuffle, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth, type AuthUser } from "@/lib/auth-context";
import { useFetch } from "@/lib/use-fetch";
import { patchJson, postJson } from "@/lib/api";
import { PERMISSIONS, type DevCompany, type DevUser } from "@/lib/dev";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Field, LoadView, selectClass } from "./shared";
import { CleanupConfirmation } from "./cleanup";

export function UserCreator({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  return <div className="space-y-5"><Button onClick={() => setOpen(value => !value)} variant={open ? "outline" : "default"}>{open ? <X className="size-4" /> : <Plus className="size-4" />}{open ? "Cancel user creation" : "Create user"}</Button>{open && <CreateUserForm onSaved={() => { setOpen(false); onSaved(); }} />}</div>;
}

function CreateUserForm({ onSaved }: { onSaved: () => void }) {
  const { user } = useAuth();
  const companies = useFetch<DevCompany[]>("/api/dev/companies");
  const [email, setEmail] = useState(""), [name, setName] = useState(""), [password, setPassword] = useState(""), [reason, setReason] = useState("");
  const [role, setRole] = useState<AuthUser["role"]>("candidate"), [company, setCompany] = useState(""), [permissions, setPermissions] = useState(PERMISSIONS.slice(0, -1)), [busy, setBusy] = useState(false);
  return <form className="space-y-5 border-y py-6" onSubmit={async e => { e.preventDefault(); setBusy(true); try { await postJson("/api/dev/users", { email, full_name: name, password, role, company_id: role === "recruiter" ? Number(company) : null, permissions, reason }); setPassword(""); toast.success("User created"); onSaved(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }}>
    <h2 className="text-xl font-semibold">New user</h2><div className="grid gap-5 sm:grid-cols-2"><Field id="new-user-name" label="Full name"><Input id="new-user-name" required maxLength={200} value={name} onChange={e => setName(e.target.value)} /></Field><Field id="new-user-email" label="Email"><Input id="new-user-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} /></Field><Field id="new-user-password" label="Initial password"><PasswordInput id="new-user-password" autoComplete="new-password" required minLength={12} maxLength={200} value={password} onChange={e => setPassword(e.target.value)} /></Field><Field id="new-user-role" label="Account role"><select id="new-user-role" className={`${selectClass} w-full`} value={role} onChange={e => setRole(e.target.value as AuthUser["role"])}>{(user?.role === "superadmin" ? ["candidate", "recruiter", "developer", "superadmin"] : ["candidate", "recruiter"]).map(value => <option key={value}>{value}</option>)}</select></Field></div>
    {role === "recruiter" && <><LoadView {...companies}>{rows => <Field id="new-user-company" label="Company"><select id="new-user-company" required className={selectClass} value={company} onChange={e => setCompany(e.target.value)}><option value="">Select active company</option>{rows.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}</LoadView><fieldset className="flex flex-wrap gap-4"><legend className="mb-3 text-sm font-medium">Member permissions</legend>{PERMISSIONS.map(permission => <label key={permission} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={permissions.includes(permission)} onChange={e => setPermissions(e.target.checked ? [...permissions, permission] : permissions.filter(p => p !== permission))} />{permission}</label>)}</fieldset></>}
    <Field id="new-user-reason" label="Creation reason"><Input id="new-user-reason" required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field><Button type="submit" disabled={busy}><Plus className="size-4" />Create account</Button>
  </form>;
}

export function UserOperations({ initial, saved }: { initial: DevUser; saved: () => void }) {
  const { user } = useAuth();
  const [email, setEmail] = useState(initial.email), [name, setName] = useState(initial.full_name), [reason, setReason] = useState("");
  const [password, setPassword] = useState(""), [newPassword, setNewPassword] = useState(""), [recruiterId, setRecruiterId] = useState(""), [busy, setBusy] = useState(false);
  if (initial.id === user?.id || (["developer", "superadmin"].includes(initial.role) && user?.role !== "superadmin")) return null;
  async function action(kind: string) {
    setBusy(true);
    try {
      if (kind === "profile") await patchJson(`/api/dev/users/${initial.id}/profile`, { email, full_name: name, reason });
      if (kind === "sessions") await postJson(`/api/dev/users/${initial.id}/revoke-sessions`, { reason });
      if (kind === "password") { await postJson(`/api/dev/users/${initial.id}/password`, { password, new_password: newPassword, reason }); setPassword(""); setNewPassword(""); }
      if (kind === "transfer") { const result = await postJson<{ transferred: number }>(`/api/dev/users/${initial.id}/transfer-jobs`, { recruiter_id: Number(recruiterId), reason }); toast.success(`${result.transferred} jobs transferred`); return; }
      toast.success(kind === "profile" ? "Profile updated; sessions revoked" : kind === "password" ? "Password reset; sessions revoked" : "All sessions revoked");
      if (kind === "profile") saved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="space-y-6 border-t pt-6"><h2 className="text-xl font-semibold">Account administration</h2>
    <Field id="user-operation-reason" label="Account action reason"><Input id="user-operation-reason" required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field>
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); void action("profile"); }}><div className="grid gap-4 sm:grid-cols-2"><Field id="managed-name" label="User full name"><Input id="managed-name" required value={name} onChange={e => setName(e.target.value)} /></Field><Field id="managed-email" label="User email"><Input id="managed-email" required type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field></div><Button disabled={busy || reason.trim().length < 3} type="submit" variant="outline"><Save className="size-4" />Save user profile</Button></form>
    <Button variant="outline" disabled={busy || reason.trim().length < 3} onClick={() => action("sessions")}><LogOut className="size-4" />Sign out everywhere</Button>
    <form className="space-y-4 border-t pt-5" onSubmit={e => { e.preventDefault(); void action("password"); }}><h3 className="font-semibold">Reset password</h3><div className="grid gap-4 sm:grid-cols-2"><Field id="managed-password" label="New user password"><PasswordInput id="managed-password" required minLength={12} maxLength={200} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></Field><Field id="operator-password" label="Your administrator password"><PasswordInput id="operator-password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></Field></div><Button type="submit" variant="outline" disabled={busy || reason.trim().length < 3}><KeyRound className="size-4" />Reset user password</Button></form>
    {initial.company_id && <form className="space-y-4 border-t pt-5" onSubmit={e => { e.preventDefault(); void action("transfer"); }}><h3 className="font-semibold">Transfer job ownership</h3><p className="text-sm text-muted-foreground">Moves this user&apos;s company jobs and applicant access to another active recruiter in the same company.</p><Field id="transfer-recruiter" label="New recruiter user ID"><Input id="transfer-recruiter" type="number" min={1} required className="max-w-xs" value={recruiterId} onChange={e => setRecruiterId(e.target.value)} /></Field><Button type="submit" variant="outline" disabled={busy || reason.trim().length < 3}><Shuffle className="size-4" />Transfer jobs</Button></form>}
    <div className="space-y-4 border-t border-destructive/30 pt-5"><h3 className="font-semibold text-destructive">Delete user permanently</h3><p className="text-sm text-muted-foreground">Owned jobs and related hiring records are included. Transfer jobs first to retain them.</p><CleanupConfirmation selection={{ user_id: initial.id }} onDone={saved} /></div>
  </section>;
}
