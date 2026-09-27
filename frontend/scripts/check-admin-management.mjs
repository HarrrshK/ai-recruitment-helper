import { chromium } from "playwright";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3001";
const api = process.env.TEST_API_URL || "http://127.0.0.1:8002";
const database = process.env.TEST_DATABASE_URL || "sqlite:////tmp/hr-admin-browser.db";
assert.ok(database.startsWith("sqlite:////tmp/"), "Destructive browser checks require an isolated /tmp database");
assert.equal(new URL(api).hostname, "127.0.0.1", "Only a loopback fixture API is supported");
const cwd = fileURLToPath(new URL("../../backend/", import.meta.url));
const stamp = Date.now();
const adminEmail = `operations-${stamp}@example.com`;
const adminPassword = "test-administrator-password";
execFileSync(`${cwd}.venv/bin/python`, ["-c", `
import sys
from app.db import SessionLocal
from app.auth import hash_password
from app.models import User
with SessionLocal() as db:
    db.add(User(email=sys.argv[1], full_name="Operations test", role="superadmin", password_hash=hash_password(sys.argv[2])))
    db.commit()
`, adminEmail, adminPassword], { cwd, env: { ...process.env, DATABASE_URL: database } });

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-proxy-server"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.route("**/api/**", async route => {
  const url = new URL(route.request().url());
  await route.fulfill({ response: await route.fetch({ url: `${api}${url.pathname}${url.search}` }) });
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
let adminHeaders;
try {
  await page.goto(`${base}/login?role=developer`);
  await page.getByLabel("Email Address").fill(adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.getByRole("heading", { name: "LLM operations", exact: true }).waitFor();
  adminHeaders = { Authorization: `Bearer ${await page.evaluate(() => sessionStorage.getItem("auth_token"))}` };
  await page.goto(`${base}/dev/users`);
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  const email = `managed-${stamp}@example.com`;
  await page.getByLabel("Full name", { exact: true }).fill("Managed candidate");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Initial password", { exact: true }).fill("initial-managed-password");
  await page.getByLabel("Creation reason").fill("Browser test provisioning");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByText("User created", { exact: true }).waitFor();
  await page.getByLabel("Search users").fill(email);
  await page.getByRole("button", { name: `Manage ${email}`, exact: true }).click();
  await page.getByLabel("Account action reason").fill("Test session revocation");
  const login = await context.request.post(`${api}/api/auth/login`, { data: { email, password: "initial-managed-password", role: "candidate" } });
  assert.equal(login.status(), 200);
  const candidate = await login.json();
  await page.getByRole("button", { name: "Sign out everywhere", exact: true }).click();
  await page.getByText("All sessions revoked", { exact: true }).waitFor();
  assert.equal((await context.request.get(`${api}/api/auth/me`, { headers: { Authorization: `Bearer ${candidate.access_token}` } })).status(), 401);
  await page.getByLabel("New user password", { exact: true }).fill("reset-managed-password");
  await page.locator("#operator-password").fill(adminPassword);
  await page.getByRole("button", { name: "Reset user password", exact: true }).click();
  await page.getByText("Password reset; sessions revoked", { exact: true }).waitFor();
  assert.equal((await context.request.post(`${api}/api/auth/login`, { data: { email, password: "reset-managed-password", role: "candidate" } })).status(), 200);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "/tmp/admin-user-management-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Preview deletion", exact: true }).click();
  await page.getByRole("heading", { name: "Deletion impact: 2 records", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Permanently delete", exact: true }).isDisabled(), true);
  await page.getByLabel("Deletion reason").fill("Remove isolated browser account");
  await page.locator("#cleanup-password").fill(adminPassword);
  await page.locator("#cleanup-confirmation").fill(`DELETE USER ${candidate.user.id}`);
  await page.getByRole("checkbox", { name: /I have a backup/ }).check();
  await page.getByRole("button", { name: "Permanently delete", exact: true }).click();
  await page.getByText("2 records permanently deleted", { exact: true }).waitFor();
  assert.equal((await context.request.get(`${api}/api/dev/users?q=${email}`, { headers: adminHeaders })).status(), 200);
  assert.deepEqual(await (await context.request.get(`${api}/api/dev/users?q=${email}`, { headers: adminHeaders })).json(), []);

  const createdCompany = await context.request.post(`${api}/api/dev/companies`, { headers: adminHeaders, data: { name: `Reset fixture ${stamp}` } });
  assert.equal(createdCompany.status(), 201);
  await page.goto(`${base}/dev/database`);
  await page.getByLabel("Maintenance reason").fill("Test full isolated reset");
  await page.getByLabel("Administrator password", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Pause workspace", exact: true }).click();
  await page.getByText("Maintenance enabled", { exact: true }).waitFor();
  assert.equal((await context.request.get(`${api}/api/portal/jobs`)).status(), 503);
  await page.getByLabel("Deletion scope").selectOption("all");
  await page.getByRole("button", { name: "Preview deletion", exact: true }).click();
  await page.getByLabel("Deletion reason").fill("Remove all isolated fixture data");
  await page.locator("#cleanup-password").fill(adminPassword);
  await page.locator("#cleanup-confirmation").fill("RESET APPLICATION DATA");
  await page.getByRole("checkbox", { name: /I have a backup/ }).check();
  await page.screenshot({ path: "/tmp/admin-reset-preview-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "/tmp/admin-reset-preview-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Permanently delete", exact: true }).click();
  await page.getByText(/records permanently deleted\. Workspace remains paused\./).waitFor();
  assert.equal((await context.request.get(`${api}/api/auth/me`, { headers: adminHeaders })).status(), 200);
  assert.deepEqual(await (await context.request.get(`${api}/api/dev/companies`, { headers: adminHeaders })).json(), []);
  const audit = await (await context.request.get(`${api}/api/dev/audit?action=cleanup.executed`, { headers: adminHeaders })).json();
  assert.ok(audit.length >= 2);
  assert.ok(!JSON.stringify(audit).includes(adminPassword));
  await page.getByLabel("Administrator password", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Resume workspace", exact: true }).click();
  await page.getByText("Workspace resumed", { exact: true }).waitFor();
  assert.equal((await context.request.get(`${api}/api/portal/jobs`)).status(), 200);
  assert.deepEqual(errors, []);
  console.log("PASS: create user, revoke sessions, reset password, dependency preview, confirmed deletion, maintenance, full fixture reset, preserved admin/audit, mobile layouts and resume");
} catch (error) {
  await page.screenshot({ path: "/tmp/admin-management-failure.png", fullPage: true });
  throw error;
} finally {
  if (adminHeaders) await context.request.put(`${api}/api/dev/maintenance`, { headers: adminHeaders, data: { enabled: false, password: adminPassword, reason: "End isolated browser verification" } });
  await browser.close();
}
