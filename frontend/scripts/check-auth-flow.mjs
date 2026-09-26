import { chromium } from "playwright";
import assert from "node:assert/strict";

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-proxy-server"] });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    page.on("pageerror", error => console.log("Page error:", error.message));
    page.on("console", msg => { if (msg.type() === "error") console.log("Console:", msg.text()); });
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) console.log("Navigation:", frame.url()); });
    page.on("requestfailed", request => console.log("Request failed:", request.url(), request.failure()?.errorText));
    await page.goto(process.env.TEST_BASE_URL || "http://127.0.0.1:3000");
    await page.getByRole("heading", { name: "AI Recruiter", exact: true }).waitFor();
    assert.equal(await page.locator("aside").count(), 0);
    assert.equal(await page.locator("img").evaluate(img => img.complete && img.naturalWidth > 0), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `/tmp/hr-home-${width}.png`, fullPage: true });
    await page.getByRole("link", { name: "Continue as a candidate" }).click();
    await page.getByRole("radio", { name: "Candidate", exact: true }).waitFor({ state: "attached" });
    assert.equal(await page.getByRole("radio", { name: "Candidate", exact: true }).isChecked(), true);
    await page.getByRole("link", { name: "Create Account", exact: true }).click();
    await page.waitForURL("**/register?role=candidate");
    assert.match(page.url(), /register\?role=candidate/);
    await page.getByRole("link", { name: "Sign In", exact: true }).click();
    await page.waitForURL("**/login?role=candidate");
    await page.getByText("HR / Company", { exact: true }).click();
    await page.getByText("Candidate", { exact: true }).click();
    await page.getByLabel("Email Address").fill("hr@example.com");
    await page.getByLabel("Password", { exact: true }).fill("secret123");
    await page.screenshot({ path: `/tmp/hr-login-${width}.png`, fullPage: true });
    await page.route("**/api/auth/login", async route => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" } });
        return;
      }
      assert.equal(route.request().postDataJSON().role, "candidate");
      await route.fulfill({ headers: { "access-control-allow-origin": "*" }, json: { access_token: "test-token", user: { id: 1, full_name: "HR Person", email: "hr@example.com", role: "candidate", candidate_id: 1 } } });
    });
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await page.waitForURL("**/candidate/jobs", { waitUntil: "domcontentloaded" }).catch(async error => { await page.screenshot({ path: "/tmp/hr-auth-failure.png" }); console.log(await page.locator("body").innerText()); throw error; });
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem("auth_user")).role), "candidate");
    await page.close();
  }
  console.log("Desktop/mobile homepage, role persistence, and candidate login redirect passed.");
} finally {
  await browser.close();
}
