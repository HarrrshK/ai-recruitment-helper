"use client";
import { CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { downloadFile } from "@/lib/api";
import { useFetch } from "@/lib/use-fetch";
import { formatDateTime, interviewStatuses, type HiringInterview } from "@/lib/recruiter";
import { LoadView } from "@/components/recruiter/shared";

type CandidateInterview = Pick<HiringInterview, "id" | "title" | "status" | "scheduled_at" | "location" | "candidate_feedback" | "duration_minutes">;
export function CandidateInterviews({ applicationId }: { applicationId: number }) {
  const query = useFetch<CandidateInterview[]>(`/api/portal/applications/${applicationId}/interviews`);
  return <section className="mt-8 border-t pt-6"><h2 className="mb-4 text-lg font-semibold">Interviews & feedback</h2><LoadView {...query}>{rows => !rows.length ? <p className="text-sm text-muted-foreground">No interviews arranged yet.</p> : <div className="divide-y">{rows.map(i => <article key={i.id} className="space-y-2 py-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{i.title}</h3><span className="rounded-md bg-muted px-2 py-1 text-xs">{interviewStatuses[i.status]}</span></div><p className="text-sm">{formatDateTime(i.scheduled_at)} · {i.duration_minutes || 60} minutes</p>{i.scheduled_at && !["planned", "cancelled"].includes(i.status) && <Button variant="outline" onClick={() => downloadFile(`/api/portal/interviews/${i.id}/calendar`, `interview-${i.id}.ics`).catch(e => toast.error(e.message))}><CalendarDays className="size-4" />Add to calendar</Button>}{i.location && <p className="break-words text-sm text-muted-foreground">{i.location}</p>}{i.candidate_feedback && <div className="pt-3"><h4 className="text-sm font-medium">Feedback from the hiring team</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{i.candidate_feedback}</p></div>}</article>)}</div>}</LoadView></section>;
}
