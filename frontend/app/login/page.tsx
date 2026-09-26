"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Lock, Mail, Sparkles } from "lucide-react";
import { AuthRoleSelector, type LoginRole } from "@/components/auth-role-selector";
import { API_URL, errorMessage } from "@/lib/api";

import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [role, setRole] = useState<LoginRole>(params.get("role") === "candidate" ? "candidate" : params.get("role") === "developer" ? "developer" : "recruiter");
  const { login, isLoading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please fill in all fields");
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role }),
      });

      if (!res.ok) {
        throw new Error(await errorMessage(res));
      }
      const data = await res.json();

      login(data.access_token, data.user);
      toast.success(`Welcome back, ${data.user.full_name || data.user.email}!`);

      if (data.user.role === "candidate") {
        router.push("/candidate/jobs");
      } else if (["developer", "superadmin"].includes(data.user.role)) {
        router.push("/dev/llm");
      } else {
        router.push("/recruiter/dashboard");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md border-muted/60 shadow-xl backdrop-blur-sm">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-6" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Sign In to AI Recruiter</CardTitle>
          <CardDescription>
            Enter your email and password to access your account dashboard
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleLogin}>
          <CardContent className="space-y-4">
            <AuthRoleSelector role={role} onChange={setRole} disabled={isLoading} />
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 size-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="name@company.com"
                  className="pl-9"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-3 size-4 text-muted-foreground" />
                <PasswordInput
                  id="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="pl-9"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full gap-2 font-medium" disabled={isLoading || authLoading}>
              {isLoading ? "Signing in..." : "Sign In"} <ArrowRight className="size-4" />
            </Button>
            {role !== "developer" && <p className="text-center text-xs text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link href={`/register?role=${role}`} className="font-semibold text-primary hover:underline">
                Create Account
              </Link>
            </p>}
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
