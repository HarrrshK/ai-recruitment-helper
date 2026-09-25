import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3001";
const api = process.env.TEST_API_URL || "http://127.0.0.1:8001";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-proxy-server"] });
const suffix = Date.now();
const errors = [];
async function makePage(width = 1440) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const original = new URL(route.request().url());
    const response = await route.fetch({ url: `${api}${original.pathname}${original.search}` });
    await route.fulfill({ response });
  });
  return page;
}
async function noOverflow(page) { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Overflow at ${page.url()}`); }

try {
  const candidate = await makePage();
  await candidate.goto(`${base}/register?role=candidate`);
  await candidate.getByLabel("Full Name").fill("Alex Morgan");
  await candidate.getByLabel("Email Address").fill(`candidate-${suffix}@example.com`);
  await candidate.getByLabel("Password", { exact: true }).fill("secret123");
  await candidate.getByRole("button", { name: "Create Account", exact: true }).click();
  await candidate.waitForURL("**/candidate/profile");
  await candidate.getByLabel("Current position", { exact: true }).fill("Backend Developer");
  await candidate.getByLabel("Professional headline").fill("Python engineer building reliable platforms");
  await candidate.getByLabel("Location", { exact: true }).fill("Bengaluru");
  await candidate.getByLabel("Skills (comma separated)").fill("Python, SQL, Docker");
  await candidate.getByRole("button", { name: "Save profile", exact: true }).click();
  await candidate.getByText("Profile saved", { exact: true }).waitFor();
  await candidate.reload();
  assert.equal(await candidate.getByLabel("Current position", { exact: true }).inputValue(), "Backend Developer");
  await candidate.screenshot({ path: "/tmp/candidate-profile-desktop.png", fullPage: true });
  await candidate.getByRole("link", { name: "Resumes", exact: true }).click();
  await candidate.getByLabel("Resume file").setInputFiles({ name: "Alex-Morgan-Backend.txt", mimeType: "text/plain", buffer: Buffer.from("Alex Morgan\nBuilt Python APIs and SQL data pipelines for five years.\nLed service reliability projects and mentored junior developers.") });
  await candidate.getByRole("heading", { name: "Alex-Morgan-Backend.txt" }).waitFor();
  await candidate.getByRole("link", { name: "Find jobs", exact: true }).click();
  await candidate.getByLabel("Title or skill").fill("Backend");
  await candidate.getByRole("link", { name: "Backend Engineer", exact: true }).click();
  await candidate.getByLabel("Resume", { exact: true }).selectOption({ label: "Alex-Morgan-Backend.txt" });
  await candidate.getByLabel("Cover letter (optional)").fill("I would love to bring my Python platform experience to this role.");
  await candidate.getByRole("button", { name: "Submit application" }).click();
  await candidate.waitForURL(/\/candidate\/applications\/\d+$/);
  const applicationUrl = candidate.url();
  await candidate.getByRole("tab", { name: "Match & scores" }).click();
  await candidate.getByRole("button", { name: "Request match assessment" }).click();
  await candidate.getByRole("heading", { name: "Why you received this score" }).waitFor();
  await candidate.screenshot({ path: "/tmp/candidate-match-desktop.png", fullPage: true });
  await candidate.getByRole("tab", { name: "Messages", exact: true }).click();
  await candidate.getByLabel("Message", { exact: true }).fill("What are the next steps for this role?");
  await candidate.getByRole("button", { name: "Send message" }).click();
  await candidate.getByText("What are the next steps for this role?", { exact: true }).waitFor();

  const hr = await makePage();
  await hr.goto(`${base}/register?role=recruiter`);
  await hr.getByLabel("Full Name").fill("Taylor - Hiring Team");
  await hr.getByLabel("Email Address").fill(`hr-${suffix}@example.com`);
  await hr.getByLabel("Password", { exact: true }).fill("secret123");
  await hr.getByRole("button", { name: "Create Account", exact: true }).click();
  await hr.waitForURL("**/dashboard");
  await hr.goto(`${base}/messages`);
  await hr.getByText("What are the next steps for this role?", { exact: true }).waitFor();
  await hr.getByLabel("Message", { exact: true }).fill("We would like to invite you to a technical interview.");
  await hr.getByRole("button", { name: "Send message" }).click();
  await hr.getByText("We would like to invite you to a technical interview.", { exact: true }).waitFor();
  await hr.getByLabel("Stage", { exact: true }).selectOption("interview");
  await hr.getByLabel("Update for the candidate").fill("Technical interview: our team will confirm a time with you.");
  await hr.getByRole("button", { name: "Update status", exact: true }).click();
  await hr.getByText("Candidate status updated", { exact: true }).waitFor();
  await candidate.getByRole("button", { name: "Refresh messages", exact: true }).click();
  await candidate.getByText("We would like to invite you to a technical interview.", { exact: true }).waitFor();
  await candidate.screenshot({ path: "/tmp/candidate-messages-desktop.png", fullPage: true });
  await candidate.reload();
  await candidate.getByRole("heading", { name: "Current stage: Interview", exact: true }).waitFor();
  await candidate.goto(base);
  assert.equal(await candidate.getByRole("link", { name: "Login", exact: true }).count(), 0);
  assert.equal(await candidate.getByRole("link", { name: "Register", exact: true }).count(), 0);
  await candidate.goto(`${base}/login`);
  await candidate.waitForURL("**/candidate/jobs");
  assert.equal(await candidate.getByRole("navigation", { name: "Main", exact: true }).count(), 0);

  await candidate.setViewportSize({ width: 390, height: 844 });
  for (const [path, name] of [["/candidate/jobs", "jobs"], ["/candidate/profile", "profile"], ["/candidate/resumes", "resumes"], ["/candidate/applications", "applications"], ["/candidate/messages", "messages"]]) {
    await candidate.goto(`${base}${path}`);
    await candidate.getByRole("heading", { level: 1 }).waitFor();
    await noOverflow(candidate);
    await candidate.screenshot({ path: `/tmp/candidate-${name}-mobile.png`, fullPage: true });
  }
  await candidate.goto(applicationUrl);
  await candidate.getByRole("tab", { name: "Match & scores" }).click();
  await candidate.getByRole("heading", { name: "Marks by criterion" }).waitFor();
  await noOverflow(candidate);
  await candidate.screenshot({ path: "/tmp/candidate-match-mobile.png", fullPage: true });
  await candidate.getByRole("button", { name: "Sign out", exact: true }).click();
  await candidate.waitForURL(/\/login/);
  await candidate.goto(`${base}/candidate/profile`);
  await candidate.waitForURL(/\/login/);
  assert.deepEqual(errors, []);
  console.log("PASS: registration, profile persistence, upload, job search, apply, saved assessment, HR reply, status history, session navigation, mobile layouts, and sign-out guards.");
} finally { await browser.close(); }
