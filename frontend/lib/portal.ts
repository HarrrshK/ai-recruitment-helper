import type { Evidence, SkillDetail, ScoreParts } from "@/lib/types";

export type CandidateProfile = { full_name: string; email: string; headline: string; phone: string; location: string; current_position: string; bio: string; skills: string[] };
export type Resume = { id: number; filename: string; size: number; created_at: string };
export type Assessment = {
  overall_score: number; breakdown: Partial<Record<ScoreParts, number | null>>;
  weights: Partial<Record<ScoreParts, number>>; summary: string; strengths: string[]; gaps: string[];
  evidence: Evidence[]; skill_details: SkillDetail[]; years_experience: number; minimum_years: number;
  evaluated_at: string; review_scores: Record<string, number>;
};
export type Application = {
  id: number; job_id: number; job_title: string; candidate_name: string; status: string;
  resume_name: string; resume_id: number; cover_letter: string; created_at: string; updated_at: string;
  history: { status: string; note: string; at: string }[]; assessment: Assessment | null;
};
export type ConversationMessage = { id: number; sender_role: "candidate" | "recruiter"; sender_name: string; body: string; created_at: string };
export const statusLabels: Record<string, string> = { applied: "Application received", screened: "Screened", shortlisted: "Shortlisted", interview: "Interview", offer: "Offer", hired: "Hired", rejected: "Not selected", withdrawn: "Withdrawn" };
export function dateLabel(value: string) { return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); }
