"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";

export interface AuthUser {
  id: number;
  public_id?: string;
  email: string;
  full_name: string;
  role: "recruiter" | "candidate" | "developer" | "superadmin";
  candidate_id?: number | null;
  company_id?: number | null;
  permissions?: string[];
  impersonation_id?: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (token: string, user: AuthUser, rememberMe?: boolean) => void;
  logout: () => void;
  sessionError: string | null;
  retrySession: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isLoading: true,
  login: () => {},
  logout: () => {},
  sessionError: null,
  retrySession: () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const clear = () => {
      sessionStorage.removeItem("auth_token");
      sessionStorage.removeItem("auth_user");
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_user");
      localStorage.removeItem("auth_remember");
      setUser(null);
      setToken(null);
      setSessionError(null);
    };
    const expired = (event: Event) => {
      const savedToken = sessionStorage.getItem("auth_token") || localStorage.getItem("auth_token");
      if ((event as CustomEvent).detail === `Bearer ${savedToken}`) clear();
    };
    window.addEventListener("auth-expired", expired);
    async function restore() {
      const savedToken = sessionStorage.getItem("auth_token") || (localStorage.getItem("auth_remember") === "true" ? localStorage.getItem("auth_token") : null);
      try {
        if (savedToken) {
          const current = await apiFetch<AuthUser>("/api/auth/me");
          if (!active || savedToken !== (sessionStorage.getItem("auth_token") || localStorage.getItem("auth_token"))) return;
          setToken(savedToken);
          setUser(current);
          if (localStorage.getItem("auth_remember") === "true") localStorage.setItem("auth_user", JSON.stringify(current));
          else sessionStorage.setItem("auth_user", JSON.stringify(current));
        }
      } catch (error) {
        if (!active || savedToken !== (sessionStorage.getItem("auth_token") || localStorage.getItem("auth_token"))) return;
        if (error instanceof ApiError && [401, 403].includes(error.status || 0)) clear();
        else setSessionError("Your session could not be verified. Please retry.");
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void restore();
    return () => { active = false; window.removeEventListener("auth-expired", expired); };
  }, [attempt]);

  const login = (newToken: string, newUser: AuthUser, rememberMe = false) => {
    setSessionError(null);
    setToken(newToken);
    setUser(newUser);
    sessionStorage.removeItem("auth_token");
    sessionStorage.removeItem("auth_user");
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    localStorage.removeItem("auth_remember");
    if (rememberMe) {
      localStorage.setItem("auth_token", newToken);
      localStorage.setItem("auth_user", JSON.stringify(newUser));
      localStorage.setItem("auth_remember", "true");
    } else {
      sessionStorage.setItem("auth_token", newToken);
      sessionStorage.setItem("auth_user", JSON.stringify(newUser));
    }
  };

  const logout = () => {
    setSessionError(null);
    setToken(null);
    setUser(null);
    sessionStorage.removeItem("auth_token");
    sessionStorage.removeItem("auth_user");
    sessionStorage.removeItem("dev_return_session");
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    localStorage.removeItem("auth_remember");
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout, sessionError, retrySession: () => { setIsLoading(true); setSessionError(null); setAttempt(a => a + 1); } }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
