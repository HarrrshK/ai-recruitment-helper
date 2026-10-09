"use client";
import { Activity, Building2, Database, FlaskConical, ShieldCheck, Users, ArrowLeft } from "lucide-react";
import { useAuth, type AuthUser } from "@/lib/auth-context";
import { API_URL } from "@/lib/api";
import { WorkspaceShell, type WorkspaceLink } from "@/components/workspace-shell";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { MaintenanceBanner } from "@/components/dev/cleanup";
const baseLinks = [["llm", "LLM operations", Activity], ["companies", "Companies", Building2], ["users", "Users & access", Users], ["database", "Database & cache", Database], ["evaluation", "Evaluation", FlaskConical], ["audit", "Audit log", ShieldCheck]] as const;

export function DevShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const available = user?.role === "superadmin" ? ([["operations", "Platform operations", ShieldCheck], ...baseLinks] as const) : baseLinks;
  const links: WorkspaceLink[] = available.map(([path, label, icon]) => ({
    href: `/dev/${path}`, label, icon,
    group: ["llm", "evaluation"].includes(path) ? "Intelligence" : "Platform",
  }));
  return <WorkspaceShell links={links} home={user?.role === "superadmin" ? "/dev/operations" : "/dev/llm"} label={user?.role === "superadmin" ? "Platform administration" : "Developer workspace"} persona="dev" identity="Platform operations" banner={<MaintenanceBanner />}>{children}</WorkspaceShell>;
}

export function ImpersonationBanner() {
  const { user } = useAuth();
  if (!user?.impersonation_id) return null;
  async function stop() {
    const saved = sessionStorage.getItem("dev_return_session");
    if (!saved) { toast.error("Administrator session unavailable. Sign out and sign in again."); return; }
    const original = JSON.parse(saved) as { token: string; user: AuthUser };
    try {
      const response = await fetch(`${API_URL}/api/dev/impersonations/${user!.impersonation_id}`, { method: "DELETE", headers: { Authorization: `Bearer ${original.token}` } });
      if (!response.ok) throw new Error("Could not end impersonation. Sign in again as administrator.");
      sessionStorage.removeItem("dev_return_session");
      sessionStorage.setItem("auth_token", original.token);
      sessionStorage.setItem("auth_user", JSON.stringify(original.user));
      window.location.replace("/dev/users");
    } catch (error) { toast.error((error as Error).message); }
  }
  return <div role="status" className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-3 bg-amber-200 px-4 py-2 text-sm text-black"><ShieldCheck className="size-4" />Impersonating {user.email} / {user.role}<Button variant="outline" onClick={stop}><ArrowLeft className="size-4" />Return to admin</Button></div>;
}
