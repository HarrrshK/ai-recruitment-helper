import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.TEST_BASE_URL || "http://localhost:3002";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-proxy-server"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
await context.addInitScript(() => sessionStorage.setItem("auth_token", "fixture"));
let role = "recruiter", revoked = false;
const changes = [];
const permissions = ["jobs.create", "jobs.edit", "applicants.review", "interviews.manage", "messages.send", "company.edit"];
const job = { id: 1, title: "Backend Developer", brief: "Build APIs", created_at: "2026-10-01", work_mode: "remote", employment_type: "full_time", location: "Bengaluru", company_name: "Acme", openings: 3, salary_min: 500000, salary_max: 900000, salary_currency: "INR", requirements: { must_have_skills: ["Postgres"], nice_to_have_skills: ["Docker"], min_years_experience: 2 } };
await context.route("**/api/**", async route => {
  const path = new URL(route.request().url()).pathname;
  let json = { unread_count: 0, messages: [], items: [] };
  if (path === "/api/auth/me") json = { id: 1, full_name: "Workspace Manager", email: "manager@example.com", role, company_id: 1, permissions };
  else if (path === "/api/recruiter/company") json = { id: 1, name: "Acme", industry: "Software", about: "", location: "Bengaluru", size: "20", website: "", contact_email: "" };
  else if (path === "/api/recruiter/company/team") json = { members: [{ id: 2, name: "Team Member", email: "member@example.com", permissions: ["jobs.create"] }], invites: revoked ? [] : [{ id: 1, email: "invite@example.com", expires_at: "2030-01-01T00:00:00Z", accepted_at: null }] };
  else if (path === "/api/recruiter/company/team/invites") { changes.push(route.request().postDataJSON()); json = { code: "test-invitation-code" }; }
  else if (path.endsWith("/permissions")) { changes.push(route.request().postDataJSON()); json = {}; }
  else if (path === "/api/recruiter/company/team/invites/1") { revoked = true; return route.fulfill({ status: 204 }); }
  else if (path === "/api/portal/jobs") json = [job, { ...job, id: 2, title: "Office Engineer", work_mode: "onsite", salary_min: 200000 }];
  else if (path === "/api/portal/resumes") json = [];
  else if (path === "/api/recruiter/interviews/1") {
    if (route.request().method() === "PUT") changes.push(route.request().postDataJSON());
    json = { id: 1, application_id: 1, candidate_name: "Alex", job_title: "Backend Developer", title: "Technical interview", interviewer: "Manager", scheduled_at: "2030-01-01T10:00:00Z", duration_minutes: 90, status: "scheduled", location: "Video", questions: [], feedback: null };
  } else if (path.endsWith("/calendar")) return route.fulfill({ body: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", headers: { "Content-Type": "text/calendar" } });
  await route.fulfill({ json });
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(`${base}/recruiter/company`);
  await page.getByRole("heading", { name: "Team & permissions" }).waitFor();
  await page.getByLabel("Team member email", { exact: true }).fill("new@example.com");
  await page.getByLabel("Permission preset", { exact: true }).selectOption("Interviewer");
  await page.getByRole("button", { name: "Create invitation", exact: true }).click();
  await page.getByText("test-invitation-code", { exact: true }).waitFor();
  assert.deepEqual(changes[0].permissions, ["interviews.manage", "applicants.review"]);
  await page.getByRole("button", { name: "Edit permissions", exact: true }).click();
  await page.getByLabel("Permission preset", { exact: true }).last().selectOption("Coordinator");
  await page.getByRole("button", { name: "Save permissions", exact: true }).click();
  await page.getByRole("button", { name: "Revoke invitation for invite@example.com", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(revoked, false);
  await page.screenshot({ path: "/tmp/recruitment-team-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "/tmp/recruitment-team-mobile.png", fullPage: true });
  await page.goto(`${base}/recruiter/interviews/1`);
  await page.getByLabel("Duration (minutes)", { exact: true }).fill("45");
  await page.getByRole("button", { name: "Save interview", exact: true }).click();
  await page.getByText("Interview saved", { exact: true }).waitFor();
  assert.equal(changes.at(-1).duration_minutes, 45);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download calendar invite" }).click();
  assert.equal((await downloaded).suggestedFilename(), "interview-1.ics");
  await page.screenshot({ path: "/tmp/recruitment-interview-mobile.png", fullPage: true });
  role = "candidate";
  await page.goto(`${base}/candidate/jobs`);
  await page.getByText("2 open roles", { exact: true }).waitFor();
  await page.getByLabel("Work mode filter").selectOption("remote");
  await page.getByText("1 open role", { exact: true }).waitFor();
  await page.getByLabel("Minimum advertised annual salary").fill("600000");
  await page.getByText("0 open roles", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clear job filters", exact: true }).click();
  await page.getByText("2 open roles", { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "/tmp/recruitment-filters-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/recruitment-filters-desktop.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log("Recruitment expansion passed: team presets/invites/permissions, confirmation, interview duration/calendar, job filters, desktop/mobile bounds.");
} finally { await browser.close(); }
