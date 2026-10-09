"use client";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";

export const defaultWeights: Record<string, number> = { skills: 30, experience: 20, semantic: 10, ai_review: 40, eligibility: 0, projects: 0 };
const criteria = [
  ["eligibility", "Baseline eligibility", "Required skills and minimum years only. Not education, legal eligibility or an automatic rejection rule."],
  ["skills", "Skill coverage", "Evidence of required and preferred skills; demonstrated skills count more than listed skills."],
  ["experience", "Relevant experience", "Years compared with the minimum, adjusted for relevance."],
  ["projects", "Project evidence", "Required and preferred skills mentioned in an explicit Projects section. Missing project evidence scores zero."],
  ["semantic", "Semantic relevance", "Similarity between the role and professional experience."],
  ["ai_review", "AI evidence review", "Skills evidence and domain fit, with verified resume quotations."],
];
export function MatchingWeights({ value, onChange }: { value: Record<string, number>; onChange: (value: Record<string, number>) => void }) {
  const total = Object.values(value).reduce((sum, weight) => sum + weight, 0);
  return <section className="space-y-5 border-t pt-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Matching score weights</h2><Button type="button" variant="ghost" onClick={() => onChange({ ...defaultWeights })}><RotateCcw className="size-4" />Reset weights</Button></div>
    <p className="text-sm text-muted-foreground">Weights must total 100%. Criteria without applicable requirements are excluded and remaining weights are normalized. Changing weights makes existing assessments outdated.</p>
    <div className="grid gap-5 sm:grid-cols-2">{criteria.map(([key, label, reason]) => <div key={key}><label htmlFor={`weight-${key}`} className="flex justify-between gap-2 text-sm font-medium">{label}<span className="tabular-nums">{value[key]}%</span></label><input id={`weight-${key}`} type="range" min={0} max={100} step={5} value={value[key]} onChange={e => onChange({ ...value, [key]: Number(e.target.value) })} className="my-3 w-full accent-primary" /><p className="text-xs leading-5 text-muted-foreground">{reason}</p></div>)}</div>
    <p role="status" className={`text-sm font-medium ${total === 100 ? "text-primary" : "text-destructive"}`}>Total: {total}%{total !== 100 && " - adjust to 100% before saving"}</p>
  </section>;
}
