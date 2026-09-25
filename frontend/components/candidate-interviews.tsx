"use client";
import { useFetch } from "@/lib/use-fetch";
import { formatDateTime, interviewStatuses, type HiringInterview } from "@/lib/recruiter";
import { LoadView } from "@/components/recruiter/shared";

type CandidateInterview = Pick<HiringInterview, "id" | "title" | "status" | "scheduled_at" | "location" | "candidate_feedback">;
export function CandidateInterviews({ applicationId }: { applicationId: number }) {
  const query = useFetch<CandidateInterview[]>(`/api/portal/applications/${applicationId}/interviews`);
  return <section className="mt-8 border-t pt-6"><h2 className="mb-4 text-lg font-semibold">Interviews & feedback</h2><LoadView {...query}>{rows => !rows.length ? <p className="text-sm text-muted-foreground">No interviews arranged yet.</p> : <div className="divide-y">{rows.map(i => <article key={i.id} className="space-y-2 py-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{i.title}</h3><span className="rounded-md bg-muted px-2 py-1 text-xs">{interviewStatuses[i.status]}</span></div><p className="text-sm">{formatDateTime(i.scheduled_at)}</p>{i.location && <p className="break-words text-sm text-muted-foreground">{i.location}</p>}{i.candidate_feedback && <div className="pt-3"><h4 className="text-sm font-medium">Feedback from the hiring team</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{i.candidate_feedback}</p></div>}</article>)}</div>}</LoadView></section>;
}
