from datetime import UTC, datetime, timedelta

import jwt
import pytest
from sqlalchemy import select

from app.models import Company, CompanyInvite, Job, User
from app.services.workspaces import issue_invite
from tests.test_candidate_portal import account, apply, upload
from tests.test_recruiter_workspace import create_job


def test_same_company_recruiters_cannot_access_each_others_work(api, session_factory):
    client, _ = api()
    first = account(client, "first@example.com", "recruiter")
    company_id = client.get("/api/auth/me", headers=first).json()["company_id"]
    other = account(client, "second@example.com", "recruiter", company_id=company_id)
    job_id = create_job(client, first)
    own_job = create_job(client, other, title="Other recruiter's job")
    candidate = account(client)
    application_id = apply(client, candidate, job_id, upload(client, candidate))
    interview_id = client.post(f"/api/recruiter/applicants/{application_id}/interviews", headers=first, json={"title": "Technical round"}).json()["id"]
    for path in (f"/api/recruiter/jobs/{job_id}", f"/api/recruiter/applicants/{application_id}",
                 f"/api/recruiter/applicants/{application_id}/resume", f"/api/portal/applications/{application_id}",
                 f"/api/portal/applications/{application_id}/messages", f"/api/recruiter/interviews/{interview_id}",
                 f"/api/recruiter/applicants?job_id={job_id}", f"/api/recruiter/interviews?application_id={application_id}"):
        assert client.get(path, headers=other).status_code == 404, path
    for method, path, body in (
        ("post", f"/api/recruiter/jobs/{job_id}/close", {}),
        ("post", f"/api/portal/applications/{application_id}/evaluate?force=true", {}),
        ("patch", f"/api/portal/hr/applications/{application_id}/status", {"status": "rejected", "note": "Not mine"}),
        ("post", f"/api/portal/applications/{application_id}/messages", {"body": "Intrusion"}),
        ("post", f"/api/recruiter/applicants/{application_id}/interviews", {"title": "Intrusion"}),
        ("put", f"/api/recruiter/interviews/{interview_id}", {"title": "Intrusion"}),
        ("post", f"/api/recruiter/interviews/{interview_id}/questions", {}),
        ("put", f"/api/recruiter/interviews/{interview_id}/feedback", {"technical": 1, "problem_solving": 1, "communication": 1, "role_fit": 1, "recommendation": "reject", "notes": "Intrusion"}),
    ):
        assert client.request(method, path, headers=other, json=body).status_code == 404, path
    assert [j["id"] for j in client.get("/api/recruiter/jobs", headers=other).json()] == [own_job]
    for path in ("/api/recruiter/applicants", "/api/portal/hr/applications", "/api/recruiter/interviews"):
        assert client.get(path, headers=other).json() == []
    assert client.get("/api/recruiter/dashboard", headers=other).json()["applications"] == 0
    assert client.put("/api/recruiter/company", headers=first, json={"name": "Hijacked"}).status_code == 403
    with session_factory() as db:
        owner_id = db.get(Job, job_id).creator_id
    assert owner_id == client.get("/api/auth/me", headers=first).json()["id"]


def test_invites_are_email_bound_single_use_and_expiring(api, session_factory):
    client, _ = api()
    with session_factory() as db:
        company = Company(name="Invited company")
        db.add(company)
        db.flush()
        code = issue_invite(db, company.id, "invited@example.com")
        expired = issue_invite(db, company.id, "expired@example.com")
        row = db.scalar(select(CompanyInvite).where(CompanyInvite.email == "expired@example.com"))
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
        company_id = company.id
        assert code not in db.scalar(select(CompanyInvite.token_hash).where(CompanyInvite.email == "invited@example.com"))
    data = {"email": "invited@example.com", "password": "secret123", "role": "recruiter"}
    assert client.post("/api/auth/register", json=data).status_code == 422
    assert client.post("/api/auth/register", json={**data, "email": "wrong@example.com", "invite_code": code}).status_code == 422
    assert client.post("/api/auth/register", json={**data, "email": "expired@example.com", "invite_code": expired}).status_code == 422
    registered = client.post("/api/auth/register", json={**data, "invite_code": code})
    assert registered.status_code == 200
    assert registered.json()["user"]["company_id"] == company_id
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    assert client.post("/api/recruiter/company/join", headers=headers, json={"code": code}).status_code == 422
    with session_factory() as db:
        assert db.scalar(select(User).where(User.email == "wrong@example.com")) is None
        assert len(list(db.scalars(select(Company)))) == 2  # fixture company + provisioned company


def test_unassigned_jobs_are_not_claimed_or_exposed_to_recruiters(api, session_factory):
    client, _ = api()
    with session_factory() as db:
        user = db.scalar(select(User).where(User.email == "test-recruiter@example.com"))
        job = Job(title="Unknown original creator", company_id=user.company_id)
        db.add(job)
        db.commit()
        job_id = job.id
    assert client.get("/api/recruiter/jobs").json() == []
    assert client.get(f"/api/recruiter/jobs/{job_id}").status_code == 404
    for path in ("/api/jobs", "/api/candidates", "/api/dashboard", "/api/screening"):
        assert client.get(path).status_code in (403, 404, 405)


def test_existing_unassigned_recruiter_joins_by_invitation(api, session_factory):
    from app.auth import create_access_token
    client, _ = api()
    with session_factory() as db:
        user = User(email="legacy@example.com", password_hash="unused", role="recruiter")
        company = Company(name="Existing company")
        db.add_all([user, company])
        db.flush()
        code = issue_invite(db, company.id, user.email)
        db.commit()
        token = create_access_token({"sub": str(user.id), "role": "recruiter", "sid": user.session_key})
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/recruiter/company", headers=headers).json() is None
    assert client.get("/api/recruiter/jobs", headers=headers).status_code == 409
    assert client.post("/api/recruiter/company/join", headers=headers, json={"code": code}).status_code == 200
    assert client.get("/api/recruiter/jobs", headers=headers).json() == []


def test_old_public_signing_secret_cannot_forge_sessions(api):
    client, _ = api()
    user_id = client.get("/api/auth/me").json()["id"]
    forged = jwt.encode({"sub": str(user_id), "role": "recruiter", "exp": datetime.now(UTC) + timedelta(hours=1)}, "hr-recruitment-ai-system-secret-key-2026", algorithm="HS256")
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_signing_key_is_private_and_survives_restarts(tmp_path):
    from app.services.signing_key import signing_key
    path = tmp_path / "key"
    first = signing_key("", path)
    assert first == signing_key("", path)
    assert path.stat().st_mode & 0o077 == 0
    with pytest.raises(ValueError):
        signing_key("hr-recruitment-ai-system-secret-key-2026", path)


def test_company_operator_provisioning_and_legacy_assignment(api, session_factory, tmp_path, monkeypatch, capsys):
    import json
    import sys
    from app import manage_company
    client, _ = api()
    monkeypatch.setattr(manage_company, "SessionLocal", session_factory)
    monkeypatch.setattr(manage_company, "init_db", lambda: None)
    profile = tmp_path / "company.json"
    profile.write_text(json.dumps({"name": "Managed company", "website": "https://example.com"}))
    monkeypatch.setattr(sys, "argv", ["manage_company", "save-company", str(profile)])
    manage_company.main()
    company_id = int(capsys.readouterr().out.split(": ")[1])
    monkeypatch.setattr(sys, "argv", ["manage_company", "invite", str(company_id), "managed@example.com"])
    manage_company.main()
    code = capsys.readouterr().out.split(": ")[1].strip()
    response = client.post("/api/auth/register", json={"email": "managed@example.com", "password": "secret123", "role": "recruiter", "invite_code": code})
    assert response.status_code == 200
    with session_factory() as db:
        old_job = Job(title="Verified legacy role", company_id=company_id)
        db.add(old_job)
        db.commit()
        job_id = old_job.id
    monkeypatch.setattr(sys, "argv", ["manage_company", "assign-job", str(job_id), "managed@example.com"])
    manage_company.main()
    headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
    assert client.get(f"/api/recruiter/jobs/{job_id}", headers=headers).status_code == 200
    with pytest.raises(SystemExit):
        manage_company.main()  # Existing ownership cannot be overwritten.


def test_invitation_cannot_switch_existing_membership(api, session_factory):
    client, _ = api()
    headers = account(client, "member@example.com", "recruiter")
    original = client.get("/api/recruiter/company", headers=headers).json()["id"]
    with session_factory() as db:
        other = Company(name="Different company")
        db.add(other)
        db.flush()
        code = issue_invite(db, other.id, "member@example.com")
        db.commit()
    assert client.post("/api/recruiter/company/join", headers=headers, json={"code": code}).status_code == 409
    assert client.get("/api/recruiter/company", headers=headers).json()["id"] == original
