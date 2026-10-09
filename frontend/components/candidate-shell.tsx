"use client";
import { BriefcaseBusiness, ClipboardList, FileText, MessageSquare, UserRound } from "lucide-react";
import { WorkspaceShell, type WorkspaceLink } from "@/components/workspace-shell";

const links: WorkspaceLink[] = [
  { href: "/candidate/applications", label: "My applications", icon: ClipboardList, group: "Workspace" },
  { href: "/candidate/jobs", label: "Find jobs", icon: BriefcaseBusiness, group: "Your next chapter" },
  { href: "/candidate/messages", label: "Messages", icon: MessageSquare, group: "Your next chapter" },
  { href: "/candidate/resumes", label: "Resumes", icon: FileText, group: "Your profile" },
  { href: "/candidate/profile", label: "Profile", icon: UserRound, group: "Your profile" },
];

export function CandidateShell({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell links={links} home="/candidate/applications" label="Candidate workspace" persona="candidate" identity="Your career space">{children}</WorkspaceShell>;
}
