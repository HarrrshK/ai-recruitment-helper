"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Building2, KeyRound, Save } from "lucide-react";
import { toast } from "sonner";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/lib/auth-context";
import { postJson, putJson } from "@/lib/api";
import type { Company } from "@/lib/recruiter";
import { PortalHeading } from "@/components/portal-shared";
import { Field, LoadView } from "@/components/recruiter/shared";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function CompanyView() {
  const query = useFetch<Company | null>("/api/recruiter/company");
  const { user } = useAuth();
  return <><PortalHeading title="Company profile" /><LoadView {...query}>{company => company ? <section className="max-w-3xl border-t py-6"><div className="flex items-center gap-4"><Building2 className="size-9 text-primary" /><div><h2 className="text-2xl font-semibold">{company.name}</h2><p className="mt-1 text-sm text-muted-foreground">{company.industry}</p></div><span className="ml-auto rounded border px-2 py-1 text-xs">Member</span></div><dl className="my-8 grid gap-6 sm:grid-cols-2">{[["Location", company.location], ["Company size", company.size], ["Website", company.website], ["Contact email", company.contact_email]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-2 break-words text-sm">{value || "Not provided"}</dd></div>)}</dl><p className="whitespace-pre-wrap break-words text-sm leading-7">{company.about}</p><Link href="/recruiter/jobs" className={`${buttonVariants({ variant: "outline" })} mt-8`}>My posted jobs <ArrowRight className="size-4" /></Link></section> : <JoinCompany />}</LoadView>{user?.permissions?.includes("company.edit") && query.state.status === "ready" && query.state.data && <MemberCompanyEditor initial={query.state.data} reload={query.reload} />}</>;
}

function MemberCompanyEditor({ initial, reload }: { initial: Company; reload: () => void }) {
  const [form, setForm] = useState(initial), [busy, setBusy] = useState(false);
  return <form className="max-w-3xl space-y-5 border-t pt-6" onSubmit={async e => { e.preventDefault(); setBusy(true); try { await putJson("/api/recruiter/company", form); toast.success("Company profile saved"); reload(); } catch (error) { toast.error((error as Error).message); } finally { setBusy(false); } }}><h2 className="text-xl font-semibold">Edit company details</h2><div className="grid gap-4 sm:grid-cols-2">{([ ["name", "Company name"], ["industry", "Industry"], ["location", "Location"], ["website", "Website"], ["contact_email", "Contact email"] ] as const).map(([key, label]) => <Field key={key} id={`member-${key}`} label={label}><Input id={`member-${key}`} required={key === "name"} type={key === "website" ? "url" : key === "contact_email" ? "email" : "text"} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></Field>)}</div><Field id="member-about" label="About company"><Textarea id="member-about" value={form.about} onChange={e => setForm({ ...form, about: e.target.value })} /></Field><Button type="submit" disabled={busy}><Save className="size-4" />Save company profile</Button></form>;
}

function JoinCompany() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const { retrySession } = useAuth();
  async function join(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try { await postJson("/api/recruiter/company/join", { code: code.trim() }); toast.success("Company invitation accepted"); retrySession(); }
    catch (error) { toast.error((error as Error).message); } finally { setBusy(false); }
  }
  return <form onSubmit={join} className="max-w-lg space-y-5 border-t pt-6"><h2 className="text-lg font-semibold">Join your company</h2><Field id="join-code" label="Company invitation code"><Input id="join-code" autoComplete="off" required maxLength={200} value={code} onChange={e => setCode(e.target.value)} /></Field><Button type="submit" disabled={busy || !code.trim()}><KeyRound className="size-4" />{busy ? "Joining..." : "Accept invitation"}</Button></form>;
}
