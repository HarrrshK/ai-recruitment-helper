import { chromium } from "playwright";
import assert from "node:assert/strict";

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-proxy-server"] });
const base = process.env.TEST_BASE_URL || "http://localhost:3002";
try {
  for (const role of ["recruiter", "candidate", "superadmin"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    await context.addInitScript(() => { sessionStorage.setItem("auth_token", "fixture"); localStorage.setItem("theme", "dark"); });
    await context.route("**/api/**", route => {
      const path = new URL(route.request().url()).pathname;
      const data = path === "/api/auth/me" ? { id: 1, role, full_name: "Priya Mehta", email: "priya@example.com", company_id: 1, permissions: [] }
        : path === "/api/recruiter/company" ? { id: 1, name: "Acme Technologies" }
        : path === "/api/recruiter/dashboard" ? { company: { name: "Acme Technologies" }, open_jobs: 8, applications: 42, shortlisted: 9, pending_review: 12, draft_jobs: 2, stages: { applied: 12, screened: 8, shortlisted: 9, interview: 6, offer: 4, hired: 3 }, recent_applicants: [{ id: 1, candidate_name: "Maya Patel", job_title: "Backend Developer", created_at: "2026-10-01", status: "shortlisted", assessment: { overall_score: 86 } }], upcoming_interviews: [{ id: 1, candidate_name: "Maya Patel", title: "Technical interview", job_title: "Backend Developer", scheduled_at: "2026-10-12T10:00:00Z" }] }
        : path === "/api/portal/applications" ? [] : { total: 0, unread_count: 0, items: [], messages: [], conversations: [] };
      return route.fulfill({ json: data });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/${role === "recruiter" ? "recruiter/dashboard" : role === "candidate" ? "candidate/applications" : "dev/audit"}`);
    await page.locator(".workspace-content").waitFor();
    if (role === "recruiter") await page.getByRole("heading", { name: "Recent applicants" }).waitFor();
    await page.screenshot({ path: `/tmp/template-${role}-desktop.png`, fullPage: true });
    await page.getByRole("button", { name: "Search workspace pages" }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByLabel("Search pages", { exact: true }).fill("no-such-page");
    await page.getByText("No matching pages.").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Toggle light and dark mode" }).click();
    await page.screenshot({ path: `/tmp/template-${role}-light.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("dialog").waitFor();
    await page.screenshot({ path: `/tmp/template-${role}-mobile-nav.png` });
    await page.keyboard.press("Escape");
    await page.screenshot({ path: `/tmp/template-${role}-mobile.png`, fullPage: true });
    if (role === "candidate") {
      await page.goto(`${base}/recruiter/dashboard`);
      await page.waitForURL("**/candidate/applications");
      assert.equal(await page.getByRole("heading", { name: "Recruiter dashboard" }).count(), 0);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Template workspaces passed: three roles, desktop/mobile, search, drawer, themes, and candidate route restriction.");
} finally { await browser.close(); }
