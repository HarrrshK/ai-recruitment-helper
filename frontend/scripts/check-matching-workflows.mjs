import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.TEST_BASE_URL || "http://localhost:3002";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-proxy-server"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
await context.addInitScript(() => sessionStorage.setItem("auth_token", "fixture"));
const assessment = { overall_score: 40, breakdown: { skills: 40 }, weights: { skills: 1 }, summary: "More skill evidence is needed", strengths: [], gaps: ["SQL evidence"], evidence: [], skill_details: [{ skill: "SQL", kind: "must", status: "missing" }], years_experience: 1, minimum_years: 2, evaluated_at: "2026-10-01" };
const steps = [{ criterion: "skills", action: "Build and document a genuine SQL project.", current_score: 40, max_additional_points: 60 }];
const application = { id: 1, job_id: 1, job_title: "Backend Developer", status: "applied", resume_id: 1, resume_name: "resume.txt", created_at: "2026-10-01", history: [{ status: "applied", at: "2026-10-01", note: "Application received" }], assessment: null };
const recommendations = [
  { job: { id: 1, title: "Junior Developer" }, fit_score: 100, recommendation_score: 100, recommendation: "Strong starting fit", already_applied: true, matched_must: ["Python"], matched_nice: [], missing_must: [], candidate_years: 1, min_years: 1, next_steps: [] },
  { job: { id: 2, title: "Senior Developer" }, fit_score: 30, recommendation_score: 24, recommendation: "Stretch role", already_applied: false, matched_must: [], matched_nice: [], missing_must: ["SQL"], candidate_years: 1, min_years: 5, next_steps: ["Build genuine SQL evidence."] },
];
const requests = [];
await context.route("**/api/**", async route => {
  const path = new URL(route.request().url()).pathname;
  requests.push(path);
  const result = path === "/api/auth/me" ? { id: 1, full_name: "Alex Candidate", email: "alex@example.com", role: "candidate" }
    : path === "/api/portal/applications/1" ? application
    : path === "/api/portal/applications/1/evaluate" ? { ...application, private_assessment: assessment, private_improvement_steps: steps, screening_visibility: "private" }
    : path.endsWith("/cohort") ? { rank: null, assessed_count: 0, note: "Not assessed" }
    : path === "/api/portal/resumes" ? [{ id: 1, filename: "resume.txt" }]
    : path === "/api/portal/resume-screen" ? recommendations
    : path === "/api/portal/jobs" || path.endsWith("/interviews") ? []
    : { unread_count: 0, messages: [] };
  await route.fulfill({ json: result });
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(`${base}/candidate/applications/1`);
  await page.getByRole("tab", { name: "Match & scores" }).click();
  await page.getByRole("button", { name: "Check my submitted resume privately" }).click();
  await page.getByRole("heading", { name: "Your private match estimate" }).waitFor();
  await page.getByText("Up to +60 overall points", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "Match assessment pending" }).waitFor();
  assert.equal(application.assessment, null);
  await page.screenshot({ path: "/tmp/matching-private-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "/tmp/matching-private-mobile.png", fullPage: true });
  await page.goto(`${base}/candidate/jobs`);
  await page.getByLabel("Your resume", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Recommend jobs for me" }).click();
  await page.getByText("2 recommended roles", { exact: true }).waitFor();
  assert.match(await page.locator("article").first().innerText(), /Junior Developer/);
  await page.getByLabel("Recommendation filter").selectOption("unapplied");
  await page.getByText("1 recommended roles", { exact: true }).waitFor();
  assert.match(await page.locator("article").first().innerText(), /Senior Developer/);
  await page.getByText("Steps to improve this fit", { exact: true }).click();
  await page.getByText("Build genuine SQL evidence.", { exact: true }).waitFor();
  await page.getByLabel("Recommendation filter").selectOption("all");
  await page.getByLabel("Recommendation order").selectOption("gaps");
  assert.match(await page.locator("article").first().innerText(), /Senior Developer/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "/tmp/matching-recommendations-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/matching-recommendations-desktop.png", fullPage: true });
  assert.ok(!requests.some(path => path.startsWith("/api/recruiter")));
  assert.deepEqual(errors, []);
  console.log("Matching browser checks passed: private result, unchanged official assessment, feedback ceilings, ranked recommendations, filters, mobile bounds and no recruiter screening requests.");
} finally { await browser.close(); }
