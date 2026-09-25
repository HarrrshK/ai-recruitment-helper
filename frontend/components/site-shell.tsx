"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { RecruiterShell } from "@/components/recruiter-shell";
import { useAuth } from "@/lib/auth-context";
import { CandidateShell } from "@/components/candidate-shell";

export function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();
  const publicPage = ["/", "/login", "/register", "/careers"].includes(pathname) || pathname.startsWith("/careers/");
  const candidatePage = pathname.startsWith("/candidate/") || pathname.startsWith("/apply/");
  const recruiterPage = pathname.startsWith("/recruiter/");
  const recruiterHome = "/recruiter/dashboard";
  useEffect(() => {
    if (!isLoading && user && ["/login", "/register"].includes(pathname)) {
      router.replace(user.role === "candidate" ? (pathname === "/register" ? "/candidate/profile" : "/candidate/jobs") : (pathname === "/register" ? "/recruiter/company" : recruiterHome));
      return;
    }
    if (publicPage || isLoading) return;
    if (!user) router.replace(`/login?role=${candidatePage ? "candidate" : "recruiter"}`);
    else if (user.role === "candidate" && !candidatePage) router.replace("/candidate/dashboard");
    else if (user.role === "recruiter" && candidatePage) router.replace(recruiterHome);
    else if (user.role === "recruiter" && !recruiterPage) {
      const destination = pathname.startsWith("/jobs") ? `/recruiter${pathname}` : pathname === "/messages" ? "/recruiter/messages" : pathname.startsWith("/interview") ? "/recruiter/interviews" : ["/candidates", "/screening", "/pipeline", "/compare"].some(path => pathname.startsWith(path)) ? "/recruiter/applicants" : recruiterHome;
      router.replace(destination);
    }
  }, [publicPage, isLoading, user, candidatePage, recruiterPage, router, pathname]);
  if (user && ["/login", "/register"].includes(pathname)) return <main className="p-8">Opening your workspace...</main>;
  if (publicPage) return <>
    <header className="border-b bg-background"><nav aria-label="Public navigation" className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-8">
      <Link href="/" className="text-lg font-semibold">AI Recruiter</Link>
      <div className="flex items-center gap-4 text-sm"><Link href={user?.role === "candidate" ? "/candidate/jobs" : "/careers"}>Careers</Link>{!isLoading && (user ? <><Link href={user.role === "candidate" ? "/candidate/applications" : recruiterHome} className="rounded-md bg-primary px-4 py-2 text-primary-foreground">My workspace</Link><button onClick={logout}>Sign out</button></> : <><Link href="/login">Login</Link><Link href="/register" className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Register</Link></>)}</div>
    </nav></header><main>{children}</main>
  </>;
  if (isLoading || !user || (user.role === "candidate") !== candidatePage) return <main className="p-8">Loading...</main>;
  if (user.role === "candidate") return <CandidateShell>{children}</CandidateShell>;
  if (!recruiterPage) return <main className="p-8">Opening recruiter workspace...</main>;
  return <RecruiterShell>{children}</RecruiterShell>;
}
