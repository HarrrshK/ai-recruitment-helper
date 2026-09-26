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
const errors = [];
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
async function register(email, role, code) {
  const response = await context.request.post(`${api}/api/auth/register`, { data: { email, role, password: "secret123", full_name: role === "candidate" ? "Chat candidate" : "Chat recruiter", invite_code: code || "" } });
  assert.equal(response.status(), 200, await response.text());
  return response.json();
}
try {
  for (const route of ["login", "register"]) {
    await page.goto(`${base}/${route}?role=candidate`);
    const password = page.getByLabel("Password", { exact: true });
    await password.fill("secret123");
    assert.equal(await password.getAttribute("type"), "password");
    await page.getByRole("button", { name: "Show password", exact: true }).click();
    assert.equal(await password.getAttribute("type"), "text");
    assert.equal(await password.inputValue(), "secret123");
    await page.getByRole("button", { name: "Hide password", exact: true }).click();
    assert.equal(await password.getAttribute("type"), "password");
    assert.ok(page.url().includes(route));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/password-toggle-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const email = `chat-hr-${stamp}@example.com`;
  const invitation = provisionInvite(email);
  const hr = await register(email, "recruiter", invitation.code);
  const candidate = await register(`chat-candidate-${stamp}@example.com`, "candidate");
  const hrHeaders = { Authorization: `Bearer ${hr.access_token}` };
  const candidateHeaders = { Authorization: `Bearer ${candidate.access_token}` };
  const jobResponse = await context.request.post(`${api}/api/recruiter/jobs`, { headers: hrHeaders, data: { title: `Chat role ${stamp}`, markdown: "Build Python APIs", status: "ready", requirements: { must_have_skills: ["Python"], nice_to_have_skills: [], min_years_experience: 1, responsibilities: [] } } });
  assert.equal(jobResponse.status(), 201);
  const job = await jobResponse.json();
  const resumeResponse = await context.request.post(`${api}/api/portal/resumes`, { headers: candidateHeaders, multipart: { file: { name: "resume.txt", mimeType: "text/plain", buffer: Buffer.from("Built Python APIs and SQL data pipelines for five years. Led reliable delivery and mentored engineers.") } } });
  const applied = await context.request.post(`${api}/api/portal/applications`, { headers: candidateHeaders, data: { job_id: job.id, resume_id: (await resumeResponse.json()).id } });
  assert.equal(applied.status(), 201);
  const application = await applied.json();
  await page.evaluate(token => sessionStorage.setItem("auth_token", token), candidate.access_token);
  const hrCalls = [];
  page.on("request", request => { if (request.url().includes("/api/recruiter/") || request.url().includes("/api/portal/hr/")) hrCalls.push(request.url()); });
  for (const path of ["/recruiter/dashboard", "/recruiter/jobs", "/recruiter/applicants/1", "/recruiter/interviews", "/recruiter/company", "/recruiter/messages", "/dashboard", "/jobs", "/candidates", "/dev/users"]) {
    await page.goto(`${base}${path}`);
    await page.waitForURL(/\/candidate\//);
    assert.equal(await page.getByRole("navigation", { name: "Recruiter navigation", exact: true }).count(), 0);
  }
  assert.deepEqual(hrCalls, []);
  await page.goto(`${base}/candidate/profile`);
  await page.getByRole("button", { name: "Message notifications, 0 unread", exact: true }).waitFor();
  await page.waitForResponse(response => response.url().includes("message-notifications") && response.status() === 200);
  const path = `${api}/api/portal/applications/${application.id}/messages`;
  await context.request.post(path, { headers: hrHeaders, data: { body: "Your interview is ready to schedule." } });
  await page.getByRole("button", { name: "Message notifications, 1 unread", exact: true }).waitFor({ timeout: 15000 });
  await page.getByText("New message from Chat recruiter", { exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Message notifications, 1 unread", exact: true }).click();
  await page.getByRole("region", { name: "Unread messages", exact: true }).getByRole("link").click();
  await page.bringToFront();
  await page.getByText("Your interview is ready to schedule.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Message notifications, 0 unread", exact: true }).waitFor({ timeout: 15000 });
  await page.getByLabel("Message", { exact: true }).fill("Thank you, I am available tomorrow.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("Thank you, I am available tomorrow.", { exact: true }).waitFor();
  const hrPage = await context.newPage();
  await hrPage.goto(base);
  await hrPage.evaluate(token => sessionStorage.setItem("auth_token", token), hr.access_token);
  await hrPage.goto(`${base}/recruiter/dashboard`);
  await hrPage.getByRole("button", { name: "Message notifications, 1 unread", exact: true }).click();
  await hrPage.getByRole("region", { name: "Unread messages", exact: true }).getByRole("link").click();
  await hrPage.bringToFront();
  await hrPage.getByText("Thank you, I am available tomorrow.", { exact: true }).waitFor();
  await hrPage.getByRole("button", { name: "Message notifications, 0 unread", exact: true }).waitFor({ timeout: 15000 });
  await hrPage.getByLabel("Message", { exact: true }).fill("Confirmed for tomorrow.");
  await hrPage.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("Confirmed for tomorrow.", { exact: true }).waitFor({ timeout: 15000 });
  await page.bringToFront();
  await page.goto(`${base}/candidate/profile`);
  await context.request.post(path, { headers: hrHeaders, data: { body: "Mobile notification test" } });
  await page.getByRole("button", { name: /Message notifications, [1-9]/ }).waitFor({ timeout: 15000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /Message notifications,/ }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "/tmp/chat-notification-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log("PASS: password visibility, direct HR URL denial without HR API calls, persistent two-way notifications, read acknowledgements, live conversation refresh and mobile layout");
} catch (error) {
  await page.screenshot({ path: "/tmp/chat-access-failure.png", fullPage: true });
  throw error;
} finally { await browser.close(); }
