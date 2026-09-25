"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";

export interface AuthUser {
  id: number;
  email: string;
  full_name: string;
  role: "recruiter" | "candidate";
  candidate_id?: number | null;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isLoading: true,
  login: () => {},
  logout: () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let active = true;
    const clear = () => {
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_user");
      setUser(null);
      setToken(null);
    };
    window.addEventListener("auth-expired", clear);
    async function restore() {
      const savedToken = localStorage.getItem("auth_token");
      const savedUser = localStorage.getItem("auth_user");
      let cached: AuthUser | null = null;
      try {
        if (savedToken && savedUser) {
          cached = JSON.parse(savedUser) as AuthUser;
          const current = await apiFetch<AuthUser>("/api/auth/me");
          if (!active) return;
          setToken(savedToken);
          setUser(current);
          localStorage.setItem("auth_user", JSON.stringify(current));
        }
      } catch (error) {
        if (!active) return;
        if (!cached || (error instanceof ApiError && [401, 403].includes(error.status || 0))) clear();
        else { setToken(savedToken); setUser(cached); }
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void restore();
    return () => { active = false; window.removeEventListener("auth-expired", clear); };
  }, []);

  const login = (newToken: string, newUser: AuthUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem("auth_token", newToken);
    localStorage.setItem("auth_user", JSON.stringify(newUser));
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
