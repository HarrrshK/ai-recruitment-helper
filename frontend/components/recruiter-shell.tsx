"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BriefcaseBusiness, Building2, CalendarDays, LayoutDashboard, LogOut, MessageSquare, UsersRound } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { ThemeToggle } from "@/components/theme-toggle";
const links = [
  { href: "/recruiter/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/recruiter/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { href: "/recruiter/applicants", label: "Applicants", icon: UsersRound },
  { href: "/recruiter/interviews", label: "Interviews", icon: CalendarDays },
  { href: "/recruiter/messages", label: "Messages", icon: MessageSquare },
  { href: "/recruiter/company", label: "Company profile", icon: Building2 },
];
export function RecruiterShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  return <div className="recruiter-workspace min-h-screen bg-background text-foreground">
    <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r bg-muted/30 px-4 py-6 lg:flex">
      <Link href="/recruiter/dashboard" className="flex items-center gap-2 px-2 font-semibold"><BriefcaseBusiness className="size-6 text-primary" />AI Recruiter</Link>
      <p className="mb-7 mt-2 px-2 text-xs text-muted-foreground">Recruiter workspace</p>
      <nav aria-label="Recruiter navigation" className="space-y-1">{links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname.startsWith(href) ? "page" : undefined} className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm ${pathname.startsWith(href) ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><Icon className="size-4" />{label}</Link>)}</nav>
      <div className="mt-auto border-t pt-4"><p className="truncate px-2 text-sm font-medium">{user?.full_name || "Recruiter"}</p><p className="mt-1 truncate px-2 text-xs text-muted-foreground">{user?.email}</p><button onClick={logout} className="mt-4 flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground"><LogOut className="size-4" />Sign out</button></div>
    </aside>
    <div className="lg:pl-56"><header className="border-b"><div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-4 md:px-8"><Link href="/recruiter/dashboard" className="font-semibold lg:hidden">AI Recruiter</Link><span className="hidden text-sm text-muted-foreground lg:block">Hiring workspace</span><div className="flex items-center gap-3"><Link href="/careers" className="text-sm text-muted-foreground">Careers page</Link><ThemeToggle /><button className="p-2 lg:hidden" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut className="size-4" /></button></div></div><nav aria-label="Recruiter mobile navigation" className="flex gap-1 overflow-x-auto px-3 lg:hidden">{links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname.startsWith(href) ? "page" : undefined} className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm ${pathname.startsWith(href) ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}><Icon className="size-4" />{label}</Link>)}</nav></header><main className="mx-auto max-w-7xl px-5 py-8 md:px-8">{children}</main></div>
  </div>;
}
