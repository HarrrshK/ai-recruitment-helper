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
      if (user && token) login(token, { ...user, full_name: saved.full_name });
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
      <Button type="submit" disabled={saving}><Save className="size-4" />{saving ? "Saving..." : "Save profile"}</Button>
    </form></>;
}
