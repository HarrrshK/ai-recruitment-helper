"use client";
import { useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { useFetch } from "@/lib/use-fetch";
import { putJson } from "@/lib/api";
import type { Company } from "@/lib/recruiter";
import { PortalHeading } from "@/components/portal-shared";
import { Field, LoadView, selectClass } from "@/components/recruiter/shared";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export function CompanyView() {
  const query = useFetch<Company>("/api/recruiter/company");
  return <><PortalHeading title="Company profile" description="The company behind your jobs and candidate conversations." /><LoadView {...query}>{data => <CompanyForm initial={data} />}</LoadView></>;
}
function CompanyForm({ initial }: { initial: Company }) {
  const [company, setCompany] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { setCompany(await putJson<Company>("/api/recruiter/company", company)); toast.success("Company profile saved"); }
    catch (error) { toast.error((error as Error).message); } finally { setBusy(false); }
  }
  return <form onSubmit={save} className="max-w-3xl space-y-7"><section className="border-t pt-6"><h2 className="mb-5 text-lg font-semibold">Company details</h2><div className="grid gap-5 sm:grid-cols-2">{([ ["name", "Company name"], ["industry", "Industry"], ["location", "Location"], ["website", "Website"], ["contact_email", "Contact email"] ] as const).map(([key, label]) => <Field key={key} id={`company-${key}`} label={label}><Input id={`company-${key}`} required={key === "name"} type={key === "website" ? "url" : key === "contact_email" ? "email" : "text"} maxLength={key === "website" ? 500 : 200} value={company[key]} onChange={e => setCompany({ ...company, [key]: e.target.value })} placeholder={key === "website" ? "https://company.com" : undefined} /></Field>)}<Field id="company-size" label="Company size"><select id="company-size" className={`${selectClass} w-full`} value={company.size} onChange={e => setCompany({ ...company, size: e.target.value })}><option value="">Select size</option>{["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"].map(size => <option key={size} value={size}>{size} employees</option>)}</select></Field></div></section><section className="border-t pt-6"><Field id="company-about" label="About the company"><Textarea id="company-about" rows={7} maxLength={5000} value={company.about} onChange={e => setCompany({ ...company, about: e.target.value })} /></Field></section><Button type="submit" disabled={busy}><Save className="size-4" />{busy ? "Saving..." : "Save company profile"}</Button></form>;
}
