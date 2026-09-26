"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BriefcaseBusiness, ClipboardList, FileText, LogOut, MessageSquare, UserRound } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { ThemeToggle } from "@/components/theme-toggle";
import { MessageNotifications } from "@/components/message-notifications";

const links = [
  { href: "/candidate/jobs", label: "Find jobs", icon: BriefcaseBusiness },
  { href: "/candidate/applications", label: "My applications", icon: ClipboardList },
  { href: "/candidate/messages", label: "Messages", icon: MessageSquare },
  { href: "/candidate/resumes", label: "Resumes", icon: FileText },
  { href: "/candidate/profile", label: "Profile", icon: UserRound },
];
export function CandidateShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  return <div className="candidate-workspace min-h-screen bg-background text-foreground">
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-8">
        <Link href="/candidate/jobs" className="flex items-center gap-3 font-semibold"><BriefcaseBusiness className="size-6 text-primary" /> AI Recruiter <span className="hidden border-l pl-3 text-sm font-normal text-muted-foreground sm:inline">Candidate workspace</span></Link>
        <div className="flex items-center gap-3"><Link href="/candidate/profile" className="max-w-40 truncate text-sm">{user?.full_name || "My profile"}</Link><MessageNotifications key={`${user?.id}:${user?.role}`} /><ThemeToggle /><button onClick={logout} title="Sign out" aria-label="Sign out" className="rounded-md p-2 hover:bg-muted"><LogOut className="size-4" /></button></div>
      </div>
      <nav aria-label="Candidate navigation" className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3 md:px-6">
        {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname.startsWith(href) ? "page" : undefined} className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium ${pathname.startsWith(href) ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Icon className="size-4" />{label}</Link>)}
      </nav>
    </header>
    <main className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">{children}</main>
    <footer className="mx-auto mt-8 max-w-7xl border-t px-5 py-5 text-xs text-muted-foreground md:px-8">AI Recruiter · Candidate workspace</footer>
  </div>;
}
