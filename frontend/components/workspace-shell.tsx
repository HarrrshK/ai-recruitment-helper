"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, ChartNoAxesCombined, ChevronRight, LogOut, Menu, Search, type LucideIcon } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { ThemeToggle } from "@/components/theme-toggle";
import { MessageNotifications } from "@/components/message-notifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export type WorkspaceLink = { href: string; label: string; icon: LucideIcon; group: string };

export function WorkspaceAvatar({ name, className = "" }: { name: string; className?: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase() || "AR";
  return <span aria-hidden="true" className={`workspace-avatar ${className}`}>{initials}</span>;
}

export function WorkspaceShell({ children, links, home, label, persona, identity, banner }: {
  children: ReactNode; links: WorkspaceLink[]; home: string; label: string;
  persona: "candidate" | "recruiter" | "dev"; identity?: ReactNode; banner?: ReactNode;
}) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const active = links.find(link => pathname === link.href || pathname.startsWith(`${link.href}/`));
  const name = user?.full_name || "Your account";
  const groups = [...new Set(links.map(link => link.group))];
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(open => !open);
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const navigation = (mobile: boolean) => <nav aria-label={`${persona === "dev" ? "Developer" : persona === "candidate" ? "Candidate" : "Recruiter"}${mobile ? " mobile" : ""} navigation`}>
    {groups.map(group => <div key={group} className="workspace-nav-group"><p className="workspace-nav-label">{group}</p>{links.filter(link => link.group === group).map(({ href, label: title, icon: Icon }) => <Link key={href} href={href} aria-current={active?.href === href ? "page" : undefined} onClick={() => setMobileOpen(false)} className="workspace-nav-link"><Icon size={17} /><span>{title}</span>{active?.href === href && <span className="workspace-nav-dot" />}</Link>)}</div>)}
  </nav>;
  const account = <div className="workspace-account"><WorkspaceAvatar name={name} /><div className="min-w-0 flex-1"><p className="truncate font-semibold">{name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{user?.email}</p></div><Button variant="ghost" size="icon-sm" onClick={logout} title="Sign out" aria-label="Sign out"><LogOut size={16} /></Button></div>;
  return <div className={`workspace-layout ${persona}-workspace`}>
    <a href="#workspace-content" className="workspace-skip-link">Skip to content</a>
    <aside className="workspace-sidebar">
      <Link href={home} className="workspace-brand"><span className="workspace-brand-mark"><ChartNoAxesCombined size={21} strokeWidth={2.5} /></span>AI Recruiter<span className="text-primary">.</span></Link>
      <Link href={home} className="workspace-identity"><span className="workspace-identity-icon">AI</span><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{identity || "AI Recruitment"}</span><span className="mt-1 block text-xs text-muted-foreground">{label}</span></span><ChevronRight size={14} className="text-muted-foreground" /></Link>
      <div className="workspace-nav-scroll">{navigation(false)}</div>
      {account}
    </aside>
    <div className="workspace-body">
      <header className="workspace-topbar">
        <div className="flex min-w-0 items-center gap-3"><Button variant="ghost" size="icon-sm" className="workspace-mobile-trigger" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={19} /></Button><p className="workspace-breadcrumb"><span className="workspace-breadcrumb-parent">{label}<ChevronRight size={12} /></span><span className="truncate text-foreground">{active?.label || "Workspace"}</span></p></div>
        <div className="workspace-header-actions"><Button variant="ghost" size="sm" className="workspace-search-trigger" onClick={() => { setQuery(""); setSearchOpen(true); }} aria-label="Search workspace pages"><Search size={16} /><span>Search workspace...</span></Button>{persona !== "dev" && <MessageNotifications key={`${user?.id}:${user?.role}`} />}<ThemeToggle /><WorkspaceAvatar name={name} className="workspace-header-avatar" /></div>
      </header>
      {banner}
      <main id="workspace-content" tabIndex={-1} className="workspace-content">{children}</main>
      <footer className="workspace-footer"><span>AI Recruiter</span><span>{label}</span></footer>
    </div>
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}><SheetContent side="left" className="workspace-mobile-sheet"><SheetHeader><SheetTitle>AI Recruiter</SheetTitle><SheetDescription>{label}</SheetDescription></SheetHeader><div className="workspace-nav-scroll px-3">{navigation(true)}</div>{account}</SheetContent></Sheet>
    <Dialog open={searchOpen} onOpenChange={setSearchOpen}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Search workspace</DialogTitle><DialogDescription>Pages in your {label.toLowerCase()}.</DialogDescription></DialogHeader><Input aria-label="Search pages" placeholder="Search pages..." autoFocus value={query} onChange={event => setQuery(event.target.value)} /><div className="max-h-72 overflow-y-auto">{links.filter(link => `${link.label} ${link.group}`.toLowerCase().includes(query.toLowerCase())).map(({ href, label: title, icon: Icon }) => <Link key={href} href={href} className="workspace-search-result" onClick={() => { setSearchOpen(false); setMobileOpen(false); }}><Icon size={17} /><span>{title}</span><ArrowRight size={15} className="ml-auto" /></Link>)}{!links.some(link => `${link.label} ${link.group}`.toLowerCase().includes(query.toLowerCase())) && <p className="p-5 text-sm text-muted-foreground">No matching pages.</p>}</div></DialogContent></Dialog>
  </div>;
}
