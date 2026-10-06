import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.TEST_BASE_URL || "http://localhost:3002";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-proxy-server"] });
const user = { id: 42, public_id: "fixture-recruiter", full_name: "Priya Mehta", email: "priya@example.com", role: "recruiter", company_id: 1, permissions: ["applicants.review"] };
const job = { id: 1, title: "Backend Developer", status: "ready", location: "Bengaluru", work_mode: "hybrid", employment_type: "full_time", applicants: 3, requirements: { must_have_skills: ["Python", "PostgreSQL"], nice_to_have_skills: ["Docker"], min_years_experience: 3, education: "Degree or equivalent experience", responsibilities: [] } };
const candidates = ["Aarav Sharma", "Maya Patel", "Sam Rivera", "Jordan Lee"].map((name, index) => ({
  id: index + 1, job_id: 1, job_title: job.title, candidate_name: name, status: index === 1 ? "interview" : "shortlisted", rank: index + 1, created_at: "2026-09-25T12:00:00Z", updated_at: "2026-09-25T12:00:00Z", history: [], assessment_stale: false, resume_name: `${name.split(" ")[0]}-resume.pdf`, resume_text: "Projects\nBuilt a Python payments API handling 20,000 requests per day.",
  profile: { headline: index === 1 ? "Senior backend engineer" : "Software engineer", skills: ["Python"], bio: "", phone: "", location: "", current_position: "" },
  resume_sections: { education: [index === 1 ? "BSc Computer Science, 2018" : "BTech Information Technology, 2020"], experience: [index === 1 ? "Senior engineer at Meridian. Led a team of four building distributed payment services." : "Backend engineer at Northstar. Built and maintained Python services and PostgreSQL databases."], projects: ["Built a Python payments API handling 20,000 requests per day."] },
  assessment: { overall_score: 86 - index * 6, years_experience: 4 + index, minimum_years: 3, evaluated_at: "2026-09-25", summary: index === 1 ? "Strong distributed systems experience. PostgreSQL depth needs follow-up." : "Strong Python evidence and production database experience.", breakdown: { skills: 90 - index * 8 }, strengths: ["Production Python experience"], gaps: [index === 1 ? "PostgreSQL evidence is limited" : "Docker is listed without project evidence"], skill_details: [{ skill: "Python", status: "demonstrated", kind: "must" }, { skill: "PostgreSQL", status: index === 1 ? "listed" : "demonstrated", kind: "must" }, { skill: "Docker", status: "listed", kind: "nice" }], evidence: [{ claim: "Backend project", quote: "Built a Python payments API handling 20,000 requests per day." }] },
  interviews: index === 1 ? [{ id: 1, title: "Technical interview", status: "completed", scheduled_at: "2026-09-26T10:00:00Z", feedback: { notes: "Clear reasoning on service boundaries. Discuss indexing tradeoffs in the next round.", technical: 8, problem_solving: 9, communication: 8, role_fit: 8 } }] : [],
}));
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
await context.addInitScript(() => sessionStorage.setItem("auth_token", "fixture-session"));
await context.route("**/api/**", async route => {
  const path = new URL(route.request().url()).pathname;
  const payload = path === "/api/auth/me" ? user : path === "/api/recruiter/jobs" ? [job] : path === "/api/recruiter/applicants" ? candidates : path === "/api/recruiter/comparison" ? { job, candidates: candidates.filter(candidate => route.request().postDataJSON().application_ids.includes(candidate.id)) } : { total: 0, unread_count: 0, conversations: [], items: [] };
  await route.fulfill({ json: payload });
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(`${base}/recruiter/applicants`);
  await page.getByRole("heading", { name: "Applicants", exact: true }).waitFor();
  await page.getByLabel("Compare Aarav Sharma for Backend Developer", { exact: true }).check();
  assert.equal(await page.getByRole("button", { name: "Compare candidates", exact: true }).isEnabled(), false);
  await page.getByLabel("Compare Maya Patel for Backend Developer", { exact: true }).check();
  await page.screenshot({ path: "/tmp/applicants-polished-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Compare candidates", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("heading", { name: "Backend Developer", exact: true }).waitFor();
  await dialog.getByText("BSc Computer Science, 2018", { exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/comparison-desktop.png" });
  await dialog.getByRole("tab", { name: "Skills & gaps", exact: true }).click();
  await dialog.getByLabel("Differences only").check();
  assert.equal(await dialog.getByRole("rowheader", { name: "Python Required", exact: true }).count(), 0);
  assert.equal(await dialog.getByRole("rowheader", { name: "PostgreSQL Required", exact: true }).count(), 1);
  await dialog.getByRole("tab", { name: "Resume evidence", exact: true }).click();
  assert.equal(await dialog.locator("blockquote").count(), 2);
  await dialog.getByRole("tab", { name: "Interviews", exact: true }).click();
  await dialog.getByText("Clear reasoning on service boundaries. Discuss indexing tradeoffs in the next round.", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole("tab", { name: "Overview", exact: true }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
  await page.screenshot({ path: "/tmp/comparison-mobile.png" });
  await dialog.getByRole("button", { name: "Next candidate columns" }).click();
  assert.ok(await dialog.getByRole("tabpanel").evaluate(element => element.scrollLeft > 0));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "/tmp/comparison-mobile-dark.png" });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Compare Sam Rivera for Backend Developer", { exact: true }).check();
  await page.getByLabel("Compare Jordan Lee for Backend Developer", { exact: true }).check();
  await page.getByRole("button", { name: "Compare candidates", exact: true }).click();
  await dialog.getByText("4 selected applicants", { exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/comparison-four-dark.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/applicants-polished-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log("Comparison UI passed: selection, tabs, skill differences, evidence, interviews, mobile bounds, and no page errors.");
} catch (error) {
  await page.screenshot({ path: "/tmp/comparison-error.png", fullPage: true });
  console.error({ errors, body: (await page.locator("body").innerText()).slice(0, 2000) });
  throw error;
} finally { await browser.close(); }
