import { chromium } from "playwright";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3001";
const api = process.env.TEST_API_URL || "http://127.0.0.1:8002";
const database = process.env.TEST_DATABASE_URL || "sqlite:////tmp/hr-dev-console.db";
assert.ok(database.startsWith("sqlite:////tmp/"));
const cwd = fileURLToPath(new URL("../../backend/", import.meta.url));
const stamp = Date.now();
const email = `admin-${stamp}@example.com`;
execFileSync(`${cwd}.venv/bin/python`, ["-c", `
import sys
from app.db import SessionLocal
from app.auth import hash_password
from app.models import User, AgentRun
with SessionLocal() as db:
    db.add(User(email=sys.argv[1], full_name="Browser administrator", role="superadmin", password_hash=hash_password("browser-test-password")))
    db.add(AgentRun(agent="matcher", model="fixture", provider="fixture", tokens=200, latency_ms=650, cached=False, estimated_cost=0.002))
    db.commit()
`, email], { cwd, env: { ...process.env, DATABASE_URL: database } });

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-proxy-server"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.route("**/api/**", async route => {
  const url = new URL(route.request().url());
  await route.fulfill({ response: await route.fetch({ url: `${api}${url.pathname}${url.search}` }) });
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(`${base}/login?role=developer`);
  await page.getByLabel("Email Address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.getByRole("heading", { name: "LLM operations", exact: true }).waitFor();
  await page.getByText("matcher", { exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/dev-telemetry-desktop.png", fullPage: true });
  await page.getByRole("tab", { name: "Prompt playground" }).click();
  await page.getByLabel("System prompt").fill("You are a careful recruitment assistant. Use only supplied evidence.");
  await page.getByLabel("Version note").fill("Browser regression version");
  await page.getByRole("button", { name: "Compare changes" }).click();
  await page.getByRole("button", { name: "Publish version" }).click();
  await page.getByText("Prompt version published", { exact: true }).waitFor();
  await page.goto(`${base}/dev/companies`);
  await page.getByRole("button", { name: "Create company", exact: true }).click();
  const company = `Browser company ${stamp}`;
  await page.getByLabel("Company name", { exact: true }).fill(company);
  await page.getByRole("button", { name: "Save company", exact: true }).click();
  await page.getByRole("button", { name: `Edit ${company}`, exact: true }).click();
  await page.locator("#knowledge-file").setInputFiles({ name: "company_info.md", mimeType: "text/markdown", buffer: Buffer.from("# Company\nRemote engineering team.") });
  await page.getByText("Knowledge file saved", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  await page.getByLabel("Company", { exact: true }).selectOption({ label: company });
  await page.getByLabel("Recruiter email", { exact: true }).fill(`hr-${stamp}@example.com`);
  await page.getByRole("button", { name: "Generate invite", exact: true }).click();
  await page.getByRole("button", { name: "Copy invitation code", exact: true }).waitFor();
  await page.goto(`${base}/dev/evaluation`);
  await page.getByRole("button", { name: "Run benchmark", exact: true }).click();
  await page.getByText("completed / 127 of 127 passed", { exact: true }).waitFor({ timeout: 30000 });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate dataset", exact: true }).click();
  assert.equal((await download).suggestedFilename(), "synthetic-42.json");
  await page.goto(`${base}/dev/database`);
  await page.getByLabel("Database table").selectOption("users");
  await page.getByRole("columnheader", { name: "email", exact: true }).waitFor();
  assert.equal(await page.getByRole("columnheader", { name: "password_hash", exact: true }).count(), 0);
  const candidateEmail = `candidate-${stamp}@example.com`;
  const candidate = await context.request.post(`${api}/api/auth/register`, { data: { email: candidateEmail, password: "browser-test-password", role: "candidate", full_name: "Support candidate" } });
  assert.equal(candidate.status(), 200);
  await page.goto(`${base}/dev/users`);
  await page.getByLabel("Search users").fill(candidateEmail);
  await page.getByRole("button", { name: "Impersonate", exact: true }).click();
  await page.getByLabel("Support reason").fill("Verify candidate workspace access");
  await page.getByRole("button", { name: "Start support session", exact: true }).click();
  await page.getByRole("button", { name: "Return to admin", exact: true }).click();
  await page.getByRole("heading", { name: "Users & access", exact: true }).waitFor();
  for (const [route, title] of [["llm", "LLM operations"], ["companies", "Companies"], ["users", "Users & access"], ["database", "Database & cache"], ["evaluation", "Evaluation"], ["audit", "Audit log"]]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/dev/${route}`);
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
    await page.waitForTimeout(350);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route} mobile overflow`);
    await page.screenshot({ path: `/tmp/dev-${route}-mobile.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/dev/llm`);
  await page.getByRole("button", { name: "Toggle light and dark mode" }).click();
  await page.waitForTimeout(300);
  assert.ok(await page.locator("html").evaluate(el => el.classList.contains("dark")));
  await page.screenshot({ path: "/tmp/dev-telemetry-dark.png", fullPage: true });
  console.log("PASS: developer login, telemetry, prompt version, company knowledge/invites, benchmark, synthetic download, redacted inspector, impersonation and all mobile views");
} catch (error) {
  await page.screenshot({ path: "/tmp/dev-console-failure.png", fullPage: true });
  console.error("Failed at", page.url());
  throw error;
} finally {
  await browser.close();
}
