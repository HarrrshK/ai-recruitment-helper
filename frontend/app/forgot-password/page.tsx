"use client";

import Link from "next/link";
import { useState } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { postJson } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try { const result = await postJson<{ message: string }>("/api/auth/password-reset/request", { email }); setSent(true); toast.success(result.message); }
    catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  }
  return <main className="flex min-h-[75vh] items-center justify-center px-4 py-10"><Card className="w-full max-w-md"><CardHeader><CardTitle>Reset your password</CardTitle><CardDescription>We’ll email a secure, one-time link if an account matches.</CardDescription></CardHeader><CardContent>{sent ? <div className="space-y-4"><p className="text-sm text-muted-foreground">Check your inbox. The link expires in 60 minutes.</p><Link className="text-sm text-primary hover:underline" href="/login">Back to sign in</Link></div> : <form onSubmit={submit} className="space-y-5"><div className="space-y-2"><Label htmlFor="reset-email">Account email</Label><div className="relative"><Mail className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input id="reset-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} className="pl-9" /></div></div><Button className="w-full" disabled={busy}>{busy ? "Sending..." : "Send reset link"}</Button><Link className="block text-center text-sm text-muted-foreground hover:text-primary" href="/login">Back to sign in</Link></form>}</CardContent></Card></main>;
}
