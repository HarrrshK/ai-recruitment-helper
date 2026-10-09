"use client";
import { BriefcaseBusiness, Building2, CalendarDays, LayoutDashboard, MessageSquare, UsersRound } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useFetch } from "@/lib/use-fetch";
import type { Company } from "@/lib/recruiter";
import { WorkspaceShell, type WorkspaceLink } from "@/components/workspace-shell";

const links: WorkspaceLink[] = [
  { href: "/recruiter/dashboard", label: "Overview", icon: LayoutDashboard, group: "Workspace" },
  { href: "/recruiter/applicants", label: "Applicants", icon: UsersRound, group: "Recruitment" },
  { href: "/recruiter/jobs", label: "Jobs", icon: BriefcaseBusiness, group: "Recruitment" },
  { href: "/recruiter/interviews", label: "Interviews", icon: CalendarDays, group: "Recruitment" },
  { href: "/recruiter/messages", label: "Messages", icon: MessageSquare, group: "Recruitment" },
  { href: "/recruiter/company", label: "Company profile", icon: Building2, group: "Organization" },
];

export function RecruiterShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const company = useFetch<Company>(user?.company_id ? "/api/recruiter/company" : "");
  return <WorkspaceShell links={links} home="/recruiter/dashboard" label="HR workspace" persona="recruiter" identity={company.state.status === "ready" ? company.state.data.name : "Your company"}>{children}</WorkspaceShell>;
}
