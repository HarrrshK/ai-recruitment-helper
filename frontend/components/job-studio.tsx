"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, FileText, ListChecks, Loader2, MessagesSquare, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { JdPreview } from "@/components/jd-preview";
import { LanguagePanel } from "@/components/language-panel";
import { RequirementsPanel } from "@/components/requirements-panel";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { postJson, putJson } from "@/lib/api";
import { applySuggestion } from "@/lib/language";
import { streamSSE, type JdEvent } from "@/lib/sse";
import type { Job, LanguageFlag } from "@/lib/types";
import { useFetch } from "@/lib/use-fetch";

export function JobStudio({ jobId, autoGenerate }: { jobId: number; autoGenerate: boolean }) {
  const { state, reload } = useFetch<Job>(`/api/jobs/${jobId}`);

  if (state.status === "loading") return <StudioSkeleton />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;
  return <StudioEditor job={state.data} autoGenerate={autoGenerate} />;
}

type Tab = "preview" | "edit";

function StudioEditor({ job, autoGenerate }: { job: Job; autoGenerate: boolean }) {
  const [title, setTitle] = useState(job.title);
  const [markdown, setMarkdown] = useState(job.markdown ?? "");
  const [saved, setSaved] = useState({ title: job.title, markdown: job.markdown ?? "" });
  const [requirements, setRequirements] = useState(job.requirements);
  const [tab, setTab] = useState<Tab>("preview");
  const autoStart = autoGenerate && !job.markdown;
  const [streaming, setStreaming] = useState(autoStart); // true from the first paint when we are about to generate
  const [saving, setSaving] = useState(false);
  const [flags, setFlags] = useState<LanguageFlag[]>([]);
  const [checkFailed, setCheckFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const dirty = title !== saved.title || markdown !== saved.markdown;
  const canSave = !saving && !streaming && title.trim().length >= 2 && markdown.trim().length > 0;

  // Stream a description from the JD Generator agent into the editor. `previous` is restored on failure.
  const runStream = useCallback(
    (previous: string, controller: AbortController) => {
      let finished = false;
      streamSSE<JdEvent>(
        `/api/jobs/${job.id}/generate`,
        (event) => {
          if (event.type === "token") {
            setMarkdown((m) => m + event.text);
          } else if (event.type === "done") {
            finished = true;
            setMarkdown(event.markdown);
            setSaved((s) => ({ ...s, markdown: event.markdown })); // the server already saved it
            setRequirements(null);
            toast.success("Job description generated");
          } else {
            finished = true;
            setMarkdown(previous);
            toast.error(event.message);
          }
        },
        controller.signal,
      )
        .then(() => {
          if (!finished && !controller.signal.aborted) {
            setMarkdown(previous);
            toast.error("Generation was interrupted. Please try again.");
          }
        })
        .catch((err: Error) => {
          setMarkdown(previous);
          toast.error(err.message);
        })
        .finally(() => {
          if (abortRef.current === controller) setStreaming(false);
        });
    },
    [job.id],
  );

  // Button-driven generation: reset the editor, then stream.
  const startGeneration = useCallback(
    (previous: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      setTab("preview");
      setMarkdown("");
      runStream(previous, controller);
    },
    [runStream],
  );

  // Arriving from the "new job" form: generate immediately.
  useEffect(() => {
    if (!autoStart) return;
    const controller = new AbortController();
    abortRef.current = controller;
    runStream("", controller);
    return () => controller.abort();
  }, [autoStart, runStream]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Re-run the (free, instant) inclusive-language check shortly after the text stops changing.
  useEffect(() => {
    if (streaming || !markdown.trim()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      postJson<LanguageFlag[]>("/api/jobs/check-language", { text: markdown })
        .then((result) => {
          if (cancelled) return;
          setFlags(result);
          setCheckFailed(false);
        })
        .catch(() => !cancelled && setCheckFailed(true));
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [markdown, streaming]);

  // Warn before losing unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save() {
    setSaving(true);
    try {
      await putJson<Job>(`/api/jobs/${job.id}`, { title, markdown });
      setSaved({ title, markdown });
      setRequirements(null);
      try {
        const analysed = await postJson<Job>(`/api/jobs/${job.id}/analyze`);
        setRequirements(analysed.requirements);
        toast.success("Saved. Requirements extracted.");
      } catch (err) {
        toast.warning(`Saved, but extracting requirements failed: ${(err as Error).message}`);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function regenerate() {
    if (dirty && markdown.trim() && !window.confirm("Regenerating replaces your unsaved edits. Continue?")) return;
    startGeneration(markdown);
  }

  const visibleFlags = markdown.trim() && !streaming ? flags : [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/jobs" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Jobs
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1 basis-72">
            <Input
              aria-label="Job title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className="h-11 border-transparent bg-transparent px-2 text-2xl font-semibold tracking-tight shadow-none hover:border-input focus-visible:border-ring dark:bg-transparent"
            />
          </div>
          <div className="flex items-center gap-2">
            {dirty && <Badge variant="secondary">Unsaved changes</Badge>}
            {saved.markdown.trim() && (
              <>
                <Link href={`/ask/${job.id}`} className={buttonVariants({ variant: "outline" })}>
                  <MessagesSquare /> Candidate Q&amp;A
                </Link>
                <Link href={`/screening/${job.id}`} className={buttonVariants({ variant: "outline" })}>
                  <ListChecks /> Screen candidates
                </Link>
              </>
            )}
            <Button variant="outline" onClick={regenerate} disabled={streaming || saving}>
              {streaming ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {markdown ? "Regenerate" : "Generate"}
            </Button>
            <Button onClick={save} disabled={!canSave}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              Save &amp; analyze
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardContent>
            <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
              <div className="flex items-center justify-between gap-3">
                <TabsList>
                  <TabsTrigger value="preview" className="px-3">Preview</TabsTrigger>
                  <TabsTrigger value="edit" className="px-3" disabled={streaming}>Edit</TabsTrigger>
                </TabsList>
                {streaming && (
                  <span className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                    <span className="size-2 animate-pulse rounded-full bg-primary" />
                    JD Generator is writing…
                  </span>
                )}
              </div>

              <TabsContent value="preview" className="pt-4">
                {markdown || streaming ? (
                  <JdPreview markdown={markdown} flags={visibleFlags} streaming={streaming} />
                ) : (
                  <EmptyState
                    icon={FileText}
                    title="No description yet"
                    description="Let the JD Generator agent draft it from your brief, or switch to Edit and write your own."
                    action={
                      <Button onClick={() => startGeneration("")}>
                        <Sparkles /> Generate description
                      </Button>
                    }
                  />
                )}
              </TabsContent>
              <TabsContent value="edit" className="pt-4">
                <Textarea
                  aria-label="Job description (Markdown)"
                  value={markdown}
                  onChange={(e) => setMarkdown(e.target.value)}
                  placeholder="Write the job description in Markdown…"
                  className="min-h-[560px] font-mono text-[13px] leading-relaxed"
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <LanguagePanel
            flags={visibleFlags}
            hasText={Boolean(markdown.trim()) && !streaming}
            onApply={(flag) => setMarkdown((m) => applySuggestion(m, flag.phrase, flag.suggestion))}
          />
          {checkFailed && (
            <p className="text-xs text-muted-foreground">Language check is unavailable right now.</p>
          )}

          {/* Recruiter Customization Controls */}
          <CustomizationPanel job={job} />

          <RequirementsPanel requirements={requirements} stale={dirty} />
          <Card>
            <CardHeader>
              <CardTitle>Original brief</CardTitle>
              <CardDescription>What you told the JD Generator.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{job.brief || "No brief provided."}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function CustomizationPanel({ job }: { job: Job }) {
  const [skillsW, setSkillsW] = useState(job.matching_rules?.skills ?? 0.3);
  const [semanticW, setSemanticW] = useState(job.matching_rules?.semantic ?? 0.1);
  const [expW, setExpW] = useState(job.matching_rules?.experience ?? 0.2);
  const [aiReviewW, setAiReviewW] = useState(job.matching_rules?.ai_review ?? 0.4);

  const [questions, setQuestions] = useState<string[]>(job.custom_questions ?? []);
  const [newQuestion, setNewQuestion] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const addQuestion = () => {
    if (!newQuestion.trim()) return;
    setQuestions([...questions, newQuestion.trim()]);
    setNewQuestion("");
  };

  const removeQuestion = (idx: number) => {
    setQuestions(questions.filter((_, i) => i !== idx));
  };

  const saveCustomSettings = async () => {
    setIsSaving(true);
    try {
      await putJson(`/api/jobs/${job.id}/custom-settings`, {
        matching_rules: {
          skills: Number(skillsW),
          semantic: Number(semanticW),
          experience: Number(expW),
          ai_review: Number(aiReviewW),
        },
        custom_questions: questions,
      });
      toast.success("Matching weights and custom questions saved!");
    } catch (err: any) {
      toast.error(err.message || "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Sparkles className="size-4 text-primary" /> Recruiter Custom Controls
        </CardTitle>
        <CardDescription className="text-xs">
          Tune evaluation weights and mandate custom interview questions
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        {/* Matching Weights sliders */}
        <div className="space-y-2 border-b pb-3">
          <span className="font-semibold text-foreground">Matching Weights Tuning</span>
          <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
            <div>
              <label className="text-muted-foreground block">Skills ({Math.round(skillsW * 100)}%)</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={skillsW}
                onChange={(e) => setSkillsW(parseFloat(e.target.value))}
                className="w-full accent-primary"
              />
            </div>
            <div>
              <label className="text-muted-foreground block">Semantic ({Math.round(semanticW * 100)}%)</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={semanticW}
                onChange={(e) => setSemanticW(parseFloat(e.target.value))}
                className="w-full accent-primary"
              />
            </div>
            <div>
              <label className="text-muted-foreground block">Experience ({Math.round(expW * 100)}%)</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={expW}
                onChange={(e) => setExpW(parseFloat(e.target.value))}
                className="w-full accent-primary"
              />
            </div>
            <div>
              <label className="text-muted-foreground block">AI Review ({Math.round(aiReviewW * 100)}%)</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={aiReviewW}
                onChange={(e) => setAiReviewW(parseFloat(e.target.value))}
                className="w-full accent-primary"
              />
            </div>
          </div>
        </div>

        {/* Custom Interview Questions */}
        <div className="space-y-2">
          <span className="font-semibold text-foreground">Custom Mandatory Questions ({questions.length})</span>
          <div className="flex gap-1.5">
            <Input
              placeholder="e.g. How do you handle concurrency?"
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
              className="h-8 text-xs bg-background"
            />
            <Button size="sm" onClick={addQuestion} className="h-8 px-2.5 text-xs">
              Add
            </Button>
          </div>

          {questions.length > 0 && (
            <ul className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
              {questions.map((q, idx) => (
                <li
                  key={idx}
                  className="flex items-center justify-between gap-2 rounded border bg-background p-1.5 text-[11px]"
                >
                  <span className="truncate">{q}</span>
                  <button
                    type="button"
                    onClick={() => removeQuestion(idx)}
                    className="text-red-500 hover:text-red-700 font-bold"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Button onClick={saveCustomSettings} disabled={isSaving} className="w-full h-8 text-xs font-semibold">
          {isSaving ? "Saving Controls..." : "Save Custom Controls"}
        </Button>
      </CardContent>
    </Card>
  );
}

function StudioSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading job">
      <Skeleton className="h-11 w-96 max-w-full" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-[560px] rounded-xl" />
        <div className="space-y-6">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
