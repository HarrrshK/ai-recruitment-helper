"use client";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { ArrowRight, Briefcase, UserCheck } from "lucide-react";

export default function Home() {
  const { user, isLoading } = useAuth();
  const workspace = user?.role === "candidate" ? "/candidate/jobs" : user?.role === "developer" || user?.role === "superadmin" ? "/dev/llm" : "/recruiter/dashboard";
  return <>
    <section className="relative flex min-h-[65vh] items-center overflow-hidden bg-zinc-900 text-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="https://images.unsplash.com/photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=2000&q=85" alt="Colleagues collaborating around a table" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative mx-auto w-full max-w-6xl px-6 py-20 md:px-8">
        <h1 className="text-5xl font-semibold sm:text-6xl">AI Recruiter</h1>
        <p className="mt-6 max-w-xl text-xl leading-relaxed text-white/90">Find your next opportunity. Find the people who move your company forward.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          {!isLoading && (user ? <Link href={workspace} className="inline-flex items-center gap-2 rounded-md bg-white px-5 py-3 font-semibold text-zinc-900">My workspace <ArrowRight className="size-4" /></Link> : <><Link href="/register" className="inline-flex items-center gap-2 rounded-md bg-white px-5 py-3 font-semibold text-zinc-900">Register <ArrowRight className="size-4" /></Link><Link href="/login" className="rounded-md border border-white/70 px-5 py-3 font-semibold">Login</Link></>)}
        </div>
      </div>
    </section>
    <section className="mx-auto grid max-w-6xl gap-10 px-6 py-12 sm:grid-cols-2 md:px-8">
      <div><Briefcase className="mb-4 size-7 text-primary" /><h2 className="text-2xl font-semibold">Hire for your company</h2><p className="mt-3 text-muted-foreground">Build your team, manage open roles, and meet your next hire.</p><Link href="/login?role=recruiter" className="mt-5 inline-flex items-center gap-2 font-medium text-primary">Continue as HR <ArrowRight className="size-4" /></Link></div>
      <div><UserCheck className="mb-4 size-7 text-primary" /><h2 className="text-2xl font-semibold">Take your next career step</h2><p className="mt-3 text-muted-foreground">Explore open positions and keep track of your applications.</p><Link href="/login?role=candidate" className="mt-5 inline-flex items-center gap-2 font-medium text-primary">Continue as a candidate <ArrowRight className="size-4" /></Link></div>
    </section>
  </>;
}
