import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.TEST_BASE_URL || "http://localhost:3002";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-proxy-server"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
await context.addInitScript(() => sessionStorage.setItem("auth_token", "fixture-session"));
const user = { id: 42, public_id: "fixture-recruiter", full_name: "Priya Mehta", email: "priya@example.com", role: "recruiter", company_id: 1, permissions: ["jobs.create", "jobs.edit"] };
const saves = [], generations = [], errors = [];
let fail = true, release, job;
await context.route("**/api/**", async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  if (path === "/api/recruiter/jobs/generate") {
    const body = request.postDataJSON(); generations.push(body);
    if (fail) return route.fulfill({ status: 503, json: { detail: "Ollama is unavailable. Retry or continue manually." } });
    await new Promise(resolve => { release = resolve; });
    return route.fulfill({ json: { generated_wording: "Join us as:", provider: "ollama", requirements: body.requirements,
      sections: [{ key: "overview", heading: "About the role", body: `Join us as: ${body.title}`, source_fields: ["title", "brief"] },
        { key: "required", heading: "Required skills", body: body.requirements.must_have_skills.join("\n"), source_fields: ["requirements.must_have_skills"] },
        { key: "experience", heading: "Experience", body: `Minimum experience: ${body.requirements.min_years_experience} years`, source_fields: ["requirements.min_years_experience"] }] } });
  }
  if (path.startsWith("/api/recruiter/jobs") && ["POST", "PUT"].includes(request.method())) {
    saves.push({ method: request.method(), body: request.postDataJSON() });
    job = { ...request.postDataJSON(), id: 1, applicants: 0, shortlisted: 0, created_at: "2026-09-27T10:00:00Z" };
    return route.fulfill({ status: request.method() === "POST" ? 201 : 200, json: job });
  }
  await route.fulfill({ json: path === "/api/auth/me" ? user : path === "/api/recruiter/jobs" ? (job ? [job] : []) : path === "/api/recruiter/jobs/1" ? job : { unread_count: 0, messages: [], items: [] } });
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(`${base}/recruiter/jobs/new`);
  await page.getByLabel("Job title", { exact: true }).fill("Manual Engineer");
  await page.getByLabel("Job description", { exact: true }).fill("Written entirely by the recruiter.");
  await page.getByLabel("Project expectations (optional, one per line)").fill("Build APIs");
  await page.getByLabel("Number of openings", { exact: true }).fill("3");
  await page.getByLabel("Minimum annual salary", { exact: true }).fill("500000");
  await page.getByLabel("Maximum annual salary", { exact: true }).fill("900000");
  await page.locator("#weight-projects").fill("10");
  assert.equal(await page.getByRole("button", { name: "Save draft", exact: true }).isEnabled(), false);
  await page.locator("#weight-skills").fill("20");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.waitForURL("**/recruiter/jobs");
  assert.equal(generations.length, 0);
  assert.equal(saves[0].body.markdown, "Written entirely by the recruiter.");
  assert.equal(saves[0].body.matching_rules.projects, 0.1);
  assert.equal(saves[0].body.matching_rules.skills, 0.2);
  assert.equal(saves[0].body.openings, 3);
  assert.equal(saves[0].body.salary_min, 500000);
  await page.goto(`${base}/recruiter/jobs/new`);
  await page.getByRole("button", { name: "Draft with AI", exact: true }).click();
  await page.getByLabel("AI provider", { exact: true }).selectOption("groq");
  await page.getByRole("button", { name: "Generate draft", exact: true }).click();
  await page.getByRole("alert").getByText("Add a job title with at least two characters.").waitFor();
  await page.getByLabel("Job title", { exact: true }).fill("Backend Engineer");
  await page.getByLabel("Location", { exact: true }).fill("Bengaluru");
  await page.getByLabel("Work mode", { exact: true }).selectOption("hybrid");
  await page.getByLabel("Employment type", { exact: true }).selectOption("contract");
  await page.getByLabel("Required skills", { exact: true }).fill("Python");
  await page.getByLabel("Required skills", { exact: true }).press("Enter");
  await page.getByLabel("Minimum experience (years)", { exact: true }).fill("2");
  await page.getByLabel("Education", { exact: true }).fill("Equivalent experience accepted");
  await page.getByLabel("Responsibilities (one per line)", { exact: true }).fill("Build APIs\nReview code");
  await page.getByRole("button", { name: "Generate draft", exact: true }).click();
  await page.getByRole("alert").getByText("Ollama is unavailable. Retry or continue manually.").waitFor();
  assert.equal(await page.getByLabel("Job title", { exact: true }).inputValue(), "Backend Engineer");
  fail = false;
  await page.getByLabel("Refinement request", { exact: true }).fill("Use formal wording and prioritize API work");
  await page.getByRole("button", { name: "Generate draft", exact: true }).click();
  await page.getByText("AI is preparing your draft. No job has been saved.").waitFor();
  assert.equal(await page.getByRole("button", { name: "Publish job", exact: true }).isEnabled(), false);
  assert.equal(await page.getByLabel("Job title", { exact: true }).isEnabled(), false);
  while (!release) await new Promise(resolve => setTimeout(resolve, 10));
  release(); release = undefined;
  assert.equal(generations.at(-1).refinement, "Use formal wording and prioritize API work");
  assert.equal(generations.at(-1).provider, "groq");
  await page.getByLabel("About the role", { exact: true }).fill("Recruiter-edited overview.");
  assert.equal(saves.length, 1);
  await page.screenshot({ path: "/tmp/job-draft-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "/tmp/job-draft-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Use reviewed draft", exact: true }).click();
  assert.ok((await page.getByLabel("Job description", { exact: true }).inputValue()).includes("Recruiter-edited overview."));
  await page.getByLabel("Minimum experience (years)", { exact: true }).fill("3");
  await page.getByText("Role details changed. Regenerate the draft or continue manually before saving.").waitFor();
  assert.equal(await page.getByRole("button", { name: "Publish job", exact: true }).isEnabled(), false);
  await page.getByRole("button", { name: "Regenerate draft", exact: true }).click();
  while (!release) await new Promise(resolve => setTimeout(resolve, 10));
  release(); release = undefined;
  await page.getByLabel("Experience", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Experience", { exact: true }).inputValue(), "Minimum experience: 3 years");
  await page.getByRole("button", { name: "Use reviewed draft", exact: true }).click();
  await page.getByRole("button", { name: "Publish job", exact: true }).click();
  await page.waitForURL("**/recruiter/jobs");
  assert.equal(saves[1].body.status, "ready");
  assert.deepEqual(saves[1].body.requirements, generations.at(-1).requirements);
  await page.goto(`${base}/recruiter/jobs/1`);
  await page.getByLabel("Job description", { exact: true }).fill("Manual revision of an existing job.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.waitForURL("**/recruiter/jobs");
  assert.equal(saves[2].method, "PUT");
  assert.equal(saves[2].body.markdown, "Manual revision of an existing job.");
  assert.deepEqual(errors, []);
  console.log("Job drafts passed: manual create/edit, validation, retry, loading, editable review, stale inputs, unchanged requirements, publish, mobile bounds, no page errors.");
} catch (error) {
  console.error({ errors, body: (await page.locator("body").innerText()).slice(-4000) });
  await page.screenshot({ path: "/tmp/job-draft-error.png", fullPage: true });
  throw error;
} finally { await browser.close(); }
