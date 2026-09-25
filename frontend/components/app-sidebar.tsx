"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Briefcase, FlaskConical, Globe, Kanban, LayoutDashboard, ListChecks, LogIn, LogOut, MessageSquare, Search, Sparkles, UserCheck, Users } from "lucide-react";
import { OPEN_ASK_EVENT } from "@/components/ask-palette";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

const RECRUITER_NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/candidates", label: "Candidates", icon: Users },
  { href: "/screening", label: "Screening", icon: ListChecks },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/messages", label: "Candidate messages", icon: MessageSquare },
  { href: "/agents", label: "Live agents", icon: Activity },
  { href: "/evaluation", label: "Evaluation", icon: FlaskConical },
];

const PUBLIC_NAV = [
  { href: "/careers", label: "Careers Portal", icon: Globe },
  { href: "/candidate/dashboard", label: "My Applications", icon: UserCheck },
];

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <Sparkles className="size-4" />
      </span>
      AI Recruiter
    </Link>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const navItems = user?.role === "candidate" ? PUBLIC_NAV : RECRUITER_NAV;

  return (
    <>
      {/* Desktop: fixed sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-sidebar p-4 md:flex">
        <Brand />
        <nav className="mt-6 flex flex-1 flex-col gap-1 overflow-y-auto" aria-label="Main">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive(href)
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>

        {user?.role === "recruiter" && <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_ASK_EVENT))}
          className="mb-3 flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <Search className="size-4" />
          <span className="flex-1">Ask HR</span>
          <kbd className="rounded border bg-muted px-1.5 text-[10px] font-medium">Ctrl K</kbd>
        </button>}

        {/* User Account / Auth Section */}
        <div className="mb-3 rounded-lg border bg-card p-2.5 text-card-foreground">
          {user ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="truncate max-w-[110px] font-semibold">{user.full_name || user.email}</span>
                <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] capitalize text-primary font-bold">
                  {user.role}
                </span>
              </div>
              <button
                type="button"
                onClick={logout}
                className="mt-1 flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 transition-colors"
              >
                <LogOut className="size-3.5" />
                Sign Out
              </button>
              <Link href="/login" onClick={logout} className="mt-1 text-xs text-primary hover:underline">Change login role</Link>
            </div>
          ) : (
            <div className="flex items-center justify-between text-xs font-medium">
              <Link href="/login" className="flex items-center gap-1 text-primary hover:underline">
                <LogIn className="size-3.5" /> Login
              </Link>
              <span className="text-muted-foreground">|</span>
              <Link href="/register" className="text-muted-foreground hover:text-foreground">
                Register
              </Link>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-xs text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
      </aside>

      {/* Mobile: brand and actions */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur md:hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-2">
          <Brand />
          <div className="flex items-center gap-1">
            <Link href="/login" onClick={logout} aria-label="Change login role" title="Change login role" className="p-2"><UserCheck className="size-4" /></Link>
            <button type="button" onClick={logout} aria-label="Sign out" title="Sign out" className="p-2"><LogOut className="size-4" /></button>
            {user?.role === "recruiter" && <button
              type="button"
              aria-label="Ask HR"
              onClick={() => window.dispatchEvent(new Event(OPEN_ASK_EVENT))}
              className="rounded-lg p-2 text-muted-foreground transition-colors"
            >
              <Search className="size-4" />
            </button>}
            <ThemeToggle />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Main">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                isActive(href) ? "bg-primary/10 text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}
