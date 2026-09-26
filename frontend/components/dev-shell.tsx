"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Building2, Database, FlaskConical, LogOut, ShieldCheck, Users, ArrowLeft } from "lucide-react";
import { useAuth, type AuthUser } from "@/lib/auth-context";
import { API_URL } from "@/lib/api";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
const links = [["llm", "LLM operations", Activity], ["companies", "Companies", Building2], ["users", "Users & access", Users], ["database", "Database & cache", Database], ["evaluation", "Evaluation", FlaskConical], ["audit", "Audit log", ShieldCheck]] as const;

export function DevShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  return <div className="dev-workspace min-h-screen"><aside className="dev-glass fixed inset-y-0 left-0 hidden w-60 flex-col border-r p-5 lg:flex"><Link href="/dev/llm" className="flex items-center gap-3 text-lg font-semibold"><ShieldCheck className="size-7 text-emerald-500" />Control room</Link><p className="mb-8 mt-2 text-xs uppercase text-muted-foreground">AI Recruiter / Operations</p><nav aria-label="Developer navigation" className="space-y-1">{links.map(([path, label, Icon]) => <Link key={path} href={`/dev/${path}`} aria-current={pathname === `/dev/${path}` ? "page" : undefined} className={`flex items-center gap-3 rounded-md p-3 text-sm ${pathname === `/dev/${path}` ? "bg-emerald-500/15 font-medium text-emerald-700 dark:text-emerald-300" : "text-muted-foreground hover:bg-muted"}`}><Icon className="size-4" />{label}</Link>)}</nav><div className="mt-auto border-t pt-4"><p className="truncate text-sm font-medium">{user?.full_name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{user?.email}</p><Button onClick={logout} className="mt-4" variant="ghost"><LogOut className="size-4" />Sign out</Button></div></aside><div className="lg:pl-60"><header className="dev-glass sticky top-0 z-20 border-b"><div className="flex items-center justify-between gap-3 px-5 py-3 md:px-8"><span className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4 text-emerald-500" />Developer workspace</span><div className="flex items-center gap-3"><span className="rounded border px-2 py-1 text-xs capitalize">{user?.role}</span><ThemeToggle /><Button variant="ghost" size="icon" className="lg:hidden" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut /></Button></div></div><nav aria-label="Developer mobile navigation" className="flex overflow-x-auto border-t px-3 lg:hidden">{links.map(([path, label, Icon]) => <Link key={path} href={`/dev/${path}`} className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm ${pathname === `/dev/${path}` ? "border-emerald-500" : "border-transparent text-muted-foreground"}`}><Icon className="size-4" />{label}</Link>)}</nav></header><main className="mx-auto max-w-[1500px] space-y-7 px-5 py-7 md:px-8">{children}</main></div></div>;
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
