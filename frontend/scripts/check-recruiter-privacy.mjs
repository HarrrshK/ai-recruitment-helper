import { chromium } from "playwright";
import assert from "node:assert/strict";
import { provisionInvite } from "./browser-invite.mjs";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3001";
const api = process.env.TEST_API_URL || "http://127.0.0.1:8002";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-proxy-server"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.route("**/api/**", async route => {
  const url = new URL(route.request().url());
  await route.fulfill({ response: await route.fetch({ url: `${api}${url.pathname}${url.search}` }) });
});
const stamp = Date.now();
async function register(email, role, invitation) {
  const response = await context.request.post(`${api}/api/auth/register`, { data: { email, role, password: "secret123", full_name: email.split("@")[0], invite_code: invitation?.code } });
  assert.equal(response.status(), 200, await response.text());
  return response.json();
}
async function signedPage(session) {
  const page = await context.newPage();
  await page.goto(base);
  await page.evaluate(s => { sessionStorage.setItem("auth_token", s.access_token); }, session);
  await page.goto(`${base}/recruiter/dashboard`);
  await page.getByRole("heading", { name: "Recruiter dashboard", exact: true }).waitFor();
  return page;
}
try {
  const firstEmail = `owner-${stamp}@example.com`;
  const secondEmail = `coworker-${stamp}@example.com`;
  const invite = provisionInvite(firstEmail);
  const first = await register(firstEmail, "recruiter", invite);
  const second = await register(secondEmail, "recruiter", provisionInvite(secondEmail, invite.company_id));
  const headers = { Authorization: `Bearer ${first.access_token}` };
  const created = await context.request.post(`${api}/api/recruiter/jobs`, { headers, data: { title: "Private owner role", markdown: "Build Python APIs", status: "ready", requirements: { must_have_skills: ["Python"], nice_to_have_skills: [], min_years_experience: 1, responsibilities: [] } } });
  assert.equal(created.status(), 201);
  const job = await created.json();
  const apps = [];
  for (const tag of ["one", "two", "closed"]) {
    const candidate = await register(`${tag}-${stamp}@example.com`, "candidate");
    const candidateHeaders = { Authorization: `Bearer ${candidate.access_token}` };
    const resume = await context.request.post(`${api}/api/portal/resumes`, { headers: candidateHeaders, multipart: { file: { name: "resume.txt", mimeType: "text/plain", buffer: Buffer.from("Built Python APIs and SQL data pipelines for five years. Led service reliability projects and mentored engineers.") } } });
    const application = await context.request.post(`${api}/api/portal/applications`, { headers: candidateHeaders, data: { job_id: job.id, resume_id: (await resume.json()).id } });
    assert.equal(application.status(), 201);
    const app = await application.json();
    apps.push(app);
    if (tag === "closed") await context.request.post(`${api}/api/portal/applications/${app.id}/withdraw`, { headers: candidateHeaders });
  }
  const owner = await signedPage(first);
  const coworker = await signedPage(second);
  await coworker.goto(`${base}/recruiter/jobs`);
  await coworker.getByText("No jobs match this view.", { exact: true }).waitFor();
  await coworker.goto(`${base}/recruiter/applicants/${apps[0].id}`);
  await coworker.getByText("Application not found", { exact: true }).waitFor();
  await owner.goto(`${base}/recruiter/applicants?job=${job.id}`);
  let failedOnce = false;
  const counts = new Map();
  await owner.route("**/api/portal/applications/*/evaluate*", async route => {
    const id = Number(route.request().url().match(/applications\/(\d+)/)[1]);
    counts.set(id, (counts.get(id) || 0) + 1);
    if (id === apps[0].id && !failedOnce) {
      failedOnce = true;
      await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ detail: "Temporary assessment failure" }) });
    } else await route.fallback();
  });
  await owner.getByRole("button", { name: "Screen all candidates & rank", exact: true }).click();
  await owner.getByText("1 assessed, 1 failed", { exact: true }).waitFor();
  await owner.getByText(/Temporary assessment failure/).waitFor();
  await owner.getByRole("button", { name: "Screen all candidates & rank", exact: true }).click();
  await owner.getByText("1 assessed, 0 failed", { exact: true }).waitFor();
  assert.equal(counts.get(apps[0].id), 2);
  assert.equal(counts.get(apps[1].id), 1);
  assert.equal(counts.has(apps[2].id), false);
  await owner.getByText("Rank #1 for this job", { exact: true }).first().waitFor();
  assert.equal(await owner.getByText("Rank #1 for this job", { exact: true }).count(), 2);
  await owner.screenshot({ path: "/tmp/recruiter-private-screening-desktop.png", fullPage: true });
  await owner.setViewportSize({ width: 390, height: 844 });
  assert.equal(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await owner.screenshot({ path: "/tmp/recruiter-private-screening-mobile.png", fullPage: true });
  await owner.setViewportSize({ width: 1440, height: 1000 });

  // A late unauthorized response from the old identity must not expire a new login.
  let release;
  let started;
  const blocked = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { started = resolve; });
  await owner.route("**/api/recruiter/jobs", async route => {
    started();
    await blocked;
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Old session expired" }) });
  }, { times: 1 });
  await owner.goto(`${base}/recruiter/jobs`);
  await requested;
  await owner.getByRole("button", { name: "Sign out", exact: true }).click();
  await owner.waitForURL(/\/login/);
  await owner.getByLabel("Email Address").fill(secondEmail);
  await owner.getByLabel("Password", { exact: true }).fill("secret123");
  await owner.getByRole("button", { name: "Sign In", exact: true }).click();
  await owner.getByRole("heading", { name: "Recruiter dashboard", exact: true }).waitFor();
  release();
  await owner.waitForTimeout(300);
  assert.equal(await owner.evaluate(() => JSON.parse(sessionStorage.getItem("auth_user")).email), secondEmail);
  await coworker.reload();
  assert.equal(await coworker.evaluate(() => sessionStorage.getItem("auth_token")), second.access_token);

  const fresh = await context.newPage();
  await fresh.goto(base);
  await fresh.getByRole("navigation", { name: "Public navigation" }).getByRole("link", { name: "Login", exact: true }).waitFor();
  await fresh.evaluate(token => localStorage.setItem("auth_token", token), first.access_token);
  await fresh.reload();
  await fresh.getByRole("navigation", { name: "Public navigation" }).getByRole("link", { name: "Login", exact: true }).waitFor();
  assert.equal(await fresh.evaluate(() => localStorage.getItem("auth_token")), null);
  console.log("PASS: same-company privacy, bulk screening failure/retry/skip/rank, mobile overflow, independent tab sessions, stale 401 protection and no inherited persistent login.");
} finally { await browser.close(); }
