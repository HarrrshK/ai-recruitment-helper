import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function provisionInvite(email, companyId) {
  const cwd = fileURLToPath(new URL("../../backend/", import.meta.url));
  const database = process.env.TEST_DATABASE_URL || "sqlite:////tmp/hr-recruiter-privacy.db";
  if (!database.startsWith("sqlite:////tmp/")) throw new Error("Browser provisioning is restricted to /tmp databases");
  return JSON.parse(execFileSync(`${cwd}.venv/bin/python`, ["-c", `
import json, sys
from app.db import SessionLocal, init_db
from app.models import Company
from app.services.workspaces import issue_invite
init_db()
with SessionLocal() as db:
    company = db.get(Company, int(sys.argv[2])) if sys.argv[2] else Company(name="Northstar Labs", industry="Developer tools", location="Bengaluru", size="51-200", website="https://example.com", about="We build dependable tools for software teams.")
    db.add(company)
    db.flush()
    code = issue_invite(db, company.id, sys.argv[1])
    db.commit()
    print(json.dumps({"code": code, "company_id": company.id}))
`, email, companyId ? String(companyId) : ""], { cwd, env: { ...process.env, DATABASE_URL: database }, encoding: "utf8" }));
}
