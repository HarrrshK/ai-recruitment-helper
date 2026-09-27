"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { postJson } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/password-input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ResetPasswordPage() { return <Suspense><ResetForm /></Suspense>; }
function ResetForm() {
  const token = useSearchParams().get("token") || "";
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) { toast.error("Passwords do not match"); return; }
    setBusy(true);
    try { const result = await postJson<{ message: string }>("/api/auth/password-reset/confirm", { token, password }); toast.success(result.message); router.replace("/login"); }
    catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  }
  return <main className="flex min-h-[75vh] items-center justify-center px-4 py-10"><Card className="w-full max-w-md"><CardHeader><CardTitle>Choose a new password</CardTitle><CardDescription>Use at least 12 characters. This signs out your other sessions.</CardDescription></CardHeader><CardContent>{token ? <form onSubmit={submit} className="space-y-5"><div className="space-y-2"><Label htmlFor="new-password">New password</Label><div className="relative"><LockKeyhole className="absolute left-3 top-3 size-4 text-muted-foreground" /><PasswordInput id="new-password" autoComplete="new-password" minLength={12} required value={password} onChange={e => setPassword(e.target.value)} className="pl-9" /></div></div><div className="space-y-2"><Label htmlFor="confirm-password">Confirm password</Label><Input id="confirm-password" type="password" autoComplete="new-password" minLength={12} required value={confirm} onChange={e => setConfirm(e.target.value)} /></div><Button className="w-full" disabled={busy}>{busy ? "Updating..." : "Update password"}</Button></form> : <div className="space-y-4"><p className="text-sm text-muted-foreground">This link is missing or invalid.</p><Link href="/forgot-password" className="text-sm text-primary hover:underline">Request another link</Link></div>}</CardContent></Card></main>;
}
