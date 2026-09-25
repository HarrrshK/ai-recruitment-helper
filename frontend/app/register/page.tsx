"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { API_URL, errorMessage } from "@/lib/api";
import { ArrowRight, Briefcase, Lock, Mail, Sparkles, User, UserCheck } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function RegisterPage() {
  return <Suspense><RegisterForm /></Suspense>;
}
function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { login, isLoading: authLoading } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"recruiter" | "candidate">(params.get("role") === "candidate" ? "candidate" : "recruiter");
  const [isLoading, setIsLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !fullName) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, full_name: fullName, role }),
      });

      if (!res.ok) {
        throw new Error(await errorMessage(res));
      }
      const data = await res.json();

      login(data.access_token, data.user);
      toast.success(`Account created! Welcome, ${data.user.full_name}!`);

      if (data.user.role === "candidate") {
        router.push("/candidate/profile");
      } else {
        router.push("/recruiter/company");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
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
          <CardTitle className="text-2xl font-bold tracking-tight">Create an Account</CardTitle>
          <CardDescription>
            Join AI Recruiter as a hiring Manager/Recruiter or a Job Candidate
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleRegister}>
          <CardContent className="space-y-4">
            {/* Account Type Selector */}
            <div className="space-y-2">
              <Label>Account Type</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRole("recruiter")}
                  aria-pressed={role === "recruiter"}
                  disabled={isLoading}
                  className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-xs font-semibold transition-all ${
                    role === "recruiter"
                      ? "border-primary bg-primary/10 text-primary shadow-sm"
                      : "border-muted bg-background text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <Briefcase className="size-4" /> HR / Company
                </button>
                <button
                  type="button"
                  onClick={() => setRole("candidate")}
                  aria-pressed={role === "candidate"}
                  disabled={isLoading}
                  className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-xs font-semibold transition-all ${
                    role === "candidate"
                      ? "border-primary bg-primary/10 text-primary shadow-sm"
                      : "border-muted bg-background text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <UserCheck className="size-4" /> Candidate
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-3 size-4 text-muted-foreground" />
                <Input
                  id="fullName"
                  type="text"
                  placeholder="Jane Doe"
                  className="pl-9"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
            </div>

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
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 size-4 text-muted-foreground" />
                <Input
                  id="password"
                  minLength={6}
                  type="password"
                  placeholder="At least 6 characters"
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
              {isLoading ? "Creating Account..." : "Create Account"} <ArrowRight className="size-4" />
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Already have an account?{" "}
              <Link href={`/login?role=${role}`} className="font-semibold text-primary hover:underline">
                Sign In
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
