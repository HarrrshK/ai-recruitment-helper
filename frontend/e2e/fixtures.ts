import { test as base } from "@playwright/test";
import type { AuthUser } from "@/lib/auth-context";

type Session = { access_token: string; user: AuthUser };
export const test = base.extend<Record<never, never>, { hrSession: Session }>({
  hrSession: [async ({ playwright }, provide, workerInfo) => {
    const request = await playwright.request.newContext();
    const response = await request.post(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/auth/register`, {
      data: { email: `browser-hr-${Date.now()}-${workerInfo.workerIndex}@example.com`, password: "browser-test-password", full_name: "Browser test recruiter", role: "recruiter" },
    });
    if (!response.ok()) throw new Error(`Could not create recruiter test session: ${response.status()}`);
    await provide(await response.json() as Session);
    await request.dispose();
  }, { scope: "worker" }],
  storageState: async ({ hrSession, baseURL }, provide) => {
    await provide({ cookies: [], origins: [{ origin: new URL(baseURL || "http://localhost:3000").origin, localStorage: [
      { name: "auth_token", value: hrSession.access_token },
      { name: "auth_user", value: JSON.stringify(hrSession.user) },
    ] }] });
  },
  extraHTTPHeaders: async ({ hrSession }, provide) => {
    await provide({ Authorization: `Bearer ${hrSession.access_token}` });
  },
});
export { expect, type APIRequestContext, type Page } from "@playwright/test";
