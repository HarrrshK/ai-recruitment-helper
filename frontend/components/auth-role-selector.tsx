"use client";
import { Briefcase, UserCheck } from "lucide-react";
export type LoginRole = "recruiter" | "candidate";
export function AuthRoleSelector({ role, onChange, disabled }: { role: LoginRole; onChange: (role: LoginRole) => void; disabled: boolean }) {
  return <fieldset disabled={disabled} className="space-y-2"><legend className="mb-2 text-sm font-medium">Continue as</legend><div className="grid grid-cols-2 gap-2">
    {([ ["recruiter", "HR / Company", Briefcase], ["candidate", "Candidate", UserCheck] ] as const).map(([value, label, Icon]) => <label key={value} className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border p-3 text-sm ${role === value ? "border-primary bg-primary/10 text-primary" : "border-border"}`}><input className="sr-only peer" type="radio" name="role" value={value} checked={role === value} onChange={() => onChange(value)} /><Icon className="size-4 shrink-0" /><span className="peer-focus-visible:underline">{label}</span></label>)}
  </div></fieldset>;
}
