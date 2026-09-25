import type { Application, CandidateProfile } from "@/lib/portal";
import type { Requirements } from "@/lib/types";

export type Company = { id: number; name: string; industry: string; website: string; location: string; size: string; about: string; contact_email: string };
export type RecruiterJob = {
  id: number; title: string; brief: string; markdown: string; requirements: Requirements | null;
  status: "draft" | "ready" | "closed"; location: string; work_mode: string; employment_type: string;
  revision: number; applicants: number; shortlisted: number; created_at: string;
};
export type Applicant = Application & { rank: number | null; assessment_stale: boolean; company_name: string };
export type ApplicantDetail = Applicant & { email: string; resume_text: string; profile: Omit<CandidateProfile, "full_name" | "email"> };
export type Question = { id: number; text: string; competency: string; difficulty: string; good_answer_signals: string[] };
export type Feedback = { technical: number; problem_solving: number; communication: number; role_fit: number; recommendation: "hire" | "hold" | "reject"; notes: string; author?: string; recorded_at?: string };
export type HiringInterview = {
  id: number; application_id: number; job_id: number; job_title: string; candidate_name: string;
  title: string; interviewer: string; scheduled_at: string | null; location: string;
  status: "planned" | "scheduled" | "in_progress" | "completed" | "cancelled";
  questions: Question[] | null; feedback: Feedback | null; candidate_feedback: string;
  created_at: string; updated_at: string;
};
export type RecruiterDashboard = { company: Company; open_jobs: number; draft_jobs: number; applications: number; shortlisted: number; pending_review: number; stages: Record<string, number>; recent_applicants: Applicant[]; upcoming_interviews: HiringInterview[] };
export const jobStatuses = { draft: "Draft", ready: "Open", closed: "Closed" };
export const interviewStatuses = { planned: "Planned", scheduled: "Scheduled", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" };
export const formatDateTime = (value: string | null) => value ? new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not scheduled";
