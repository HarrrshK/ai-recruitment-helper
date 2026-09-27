"use client";
import { useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { putJson } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useFetch } from "@/lib/use-fetch";
import type { CandidateProfile } from "@/lib/portal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { LoadingPortal, PortalHeading } from "@/components/portal-shared";

export function CandidateProfileView() {
  const { state, reload } = useFetch<CandidateProfile>("/api/portal/profile");
  if (state.status === "loading") return <LoadingPortal />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;
  return <ProfileForm initial={state.data} />;
}
function ProfileForm({ initial }: { initial: CandidateProfile }) {
  const [profile, setProfile] = useState(initial);
  const [skills, setSkills] = useState(initial.skills.join(", "));
  const [saving, setSaving] = useState(false);
  const { user, token, login } = useAuth();
  async function save(e: React.FormEvent) {
    e.preventDefault(); setSaving(true);
    try {
      const saved = await putJson<CandidateProfile>("/api/portal/profile", { ...profile, skills: skills.split(",").map(s => s.trim()).filter(Boolean) });
      setProfile(saved);
      if (user && token) login(token, { ...user, full_name: saved.full_name }, localStorage.getItem("auth_remember") === "true");
      toast.success("Profile saved");
    } catch (error) { toast.error((error as Error).message); } finally { setSaving(false); }
  }
  return <><PortalHeading title="Your profile" description="Your professional details and contact information." />
    <form onSubmit={save} className="max-w-3xl space-y-8">
      <section className="border-t pt-6"><h2 className="mb-5 text-lg font-semibold">Personal details</h2><div className="grid gap-5 sm:grid-cols-2">
        {([ ["full_name", "Full name"], ["headline", "Professional headline"], ["phone", "Phone"], ["location", "Location"], ["current_position", "Current position"] ] as const).map(([key, label]) => <div key={key} className="space-y-2"><Label htmlFor={key}>{label}</Label><Input id={key} value={profile[key]} maxLength={key === "phone" ? 60 : 200} required={key === "full_name"} onChange={e => setProfile({ ...profile, [key]: e.target.value })} /></div>)}
        <div className="space-y-2"><Label htmlFor="profile-email">Account email</Label><Input id="profile-email" value={profile.email} readOnly className="bg-muted" /></div>
      </div></section>
      <section className="space-y-5 border-t pt-6"><h2 className="text-lg font-semibold">Professional background</h2><div className="space-y-2"><Label htmlFor="bio">About you</Label><Textarea id="bio" rows={5} maxLength={3000} value={profile.bio} onChange={e => setProfile({ ...profile, bio: e.target.value })} /></div><div className="space-y-2"><Label htmlFor="skills">Skills (comma separated)</Label><Input id="skills" value={skills} onChange={e => setSkills(e.target.value)} placeholder="Python, SQL, Project management" /></div></section>
      <section className="space-y-4 border-t pt-6"><div><h2 className="text-lg font-semibold">Profile sharing</h2><p className="mt-1 text-sm text-muted-foreground">Choose which optional profile details hiring teams can see. Your name and the resume you submit with an application remain part of that application.</p></div><div className="grid gap-3 sm:grid-cols-2">{([["email", "Email address"], ["phone", "Phone"], ["headline", "Headline"], ["location", "Location"], ["current_position", "Current position"], ["bio", "About you"], ["skills", "Skills"]] as const).map(([field, label]) => <label key={field} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={profile.visible_fields.includes(field)} onChange={e => setProfile({ ...profile, visible_fields: e.target.checked ? [...new Set([...profile.visible_fields, field])] : profile.visible_fields.filter(value => value !== field) })} />{label}</label>)}</div></section>
      <p className="border-t pt-5 text-xs text-muted-foreground">Account ID: <span className="font-mono">{profile.public_id}</span></p>
      <Button type="submit" disabled={saving}><Save className="size-4" />{saving ? "Saving..." : "Save profile"}</Button>
    </form></>;
}
