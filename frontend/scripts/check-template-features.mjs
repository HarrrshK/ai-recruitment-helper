import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.TEST_BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-proxy-server"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
await context.addInitScript(() => sessionStorage.setItem("auth_token", "fixture"));
let role = "recruiter";
let resumes = [{ id: 1, filename: "original.txt", size: 120, created_at: "2026-10-01" }];
let uploads = 0;
const applicants = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, job_id: 1, candidate_name: `Candidate ${String(index + 1).padStart(2, "0")}`, job_title: "Backend Developer", status: index < 3 ? "shortlisted" : "applied", rank: index + 1, created_at: "2026-10-01", assessment: { overall_score: 90 - index, years_experience: index, skill_details: [{ skill: index % 2 ? "Python" : "Java", status: "demonstrated" }] } }));
await context.route("**/api/**", async route => {
  const path = new URL(route.request().url()).pathname;
  let data = { unread_count: 0, messages: [], conversations: [] };
  if (path === "/api/auth/me") data = { id: 1, role, full_name: "Test User", email: "test@example.com", company_id: 1, permissions: [] };
  if (path === "/api/recruiter/jobs") data = [{ id: 1, title: "Backend Developer" }];
  if (path === "/api/recruiter/applicants") data = applicants;
  if (path === "/api/recruiter/company") data = { name: "Test company" };
  if (path === "/api/recruiter/interviews") data = [
    { id: 1, candidate_name: "Scheduled Candidate", job_title: "Backend Developer", title: "Technical", status: "scheduled", scheduled_at: "2026-10-15T10:00:00Z", feedback: null },
    { id: 2, candidate_name: "Feedback Candidate", job_title: "Backend Developer", title: "Technical", status: "completed", scheduled_at: "2026-10-01T10:00:00Z", feedback: null },
    { id: 3, candidate_name: "Reviewed Candidate", job_title: "Backend Developer", title: "Technical", status: "completed", scheduled_at: null, feedback: { notes: "Reviewed" } },
  ];
  if (path === "/api/portal/resumes") {
    if (route.request().method() === "POST") { uploads++; resumes = [{ id: 2, filename: "replacement.txt", size: 120, created_at: "2026-10-09" }]; }
    data = route.request().method() === "POST" ? resumes[0] : resumes;
  }
  if (path === "/api/portal/resumes/1" && route.request().method() === "DELETE") { resumes = []; return route.fulfill({ status: 204 }); }
  return route.fulfill({ json: data });
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(`${base}/recruiter/applicants`);
  await page.getByText("1-8 of 12 applicants", { exact: true }).waitFor();
  await page.getByLabel("Compare Candidate 01 for Backend Developer", { exact: true }).check();
  await page.getByRole("button", { name: "Next applicants" }).click();
  await page.getByText("9-12 of 12 applicants", { exact: true }).waitFor();
  await page.getByLabel("Compare Candidate 09 for Backend Developer", { exact: true }).check();
  assert.ok(await page.getByRole("button", { name: "Compare candidates", exact: true }).isEnabled());
  await page.getByLabel("Assessed skill", { exact: true }).selectOption("Python");
  await page.getByText("1-6 of 6 applicants", { exact: true }).waitFor();
  await page.getByLabel("Sort", { exact: true }).selectOption("experience");
  assert.match(await page.locator("article").first().innerText(), /Candidate 12/);
  await page.getByLabel("Candidate or job", { exact: true }).fill("no-match");
  await page.getByText("No applicants match these filters.").waitFor();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByText("1-8 of 12 applicants", { exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/template-features-applicants.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "/tmp/template-features-applicants-mobile.png", fullPage: true });
  await page.goto(`${base}/recruiter/interviews`);
  await page.getByRole("heading", { name: "Scheduled Candidate", exact: true }).waitFor();
  await page.getByRole("button", { name: "Awaiting feedback", exact: true }).click();
  await page.getByRole("heading", { name: "Feedback Candidate", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Reviewed Candidate", exact: true }).count(), 0);
  await page.getByRole("button", { name: "All interviews", exact: true }).click();
  await page.getByRole("heading", { name: "Reviewed Candidate", exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/template-features-interviews-mobile.png", fullPage: true });
  role = "candidate";
  await page.goto(`${base}/candidate/resumes`);
  await page.getByRole("heading", { name: "original.txt", exact: true }).waitFor();
  assert.ok(await page.getByRole("button", { name: "Upload resume", exact: true }).isDisabled());
  assert.ok(await page.getByLabel("Resume file").isDisabled());
  await page.getByRole("button", { name: "Remove original.txt", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(resumes.length, 1);
  await page.getByRole("button", { name: "Remove original.txt", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByText("No resumes uploaded yet.").waitFor();
  await page.getByLabel("Resume file").setInputFiles({ name: "replacement.txt", mimeType: "text/plain", buffer: Buffer.from("Replacement resume") });
  await page.getByRole("heading", { name: "replacement.txt", exact: true }).waitFor();
  assert.equal(uploads, 1);
  assert.ok(await page.getByRole("button", { name: "Upload resume", exact: true }).isDisabled());
  await page.screenshot({ path: "/tmp/template-features-resume-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log("Template features passed: pagination, cross-page comparison selection, skills, sorting, clear filters, agenda, feedback queue, single-resume upload and confirmed replacement.");
} finally { await browser.close(); }
