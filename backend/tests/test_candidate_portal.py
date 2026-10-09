from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.agents.resume_parser import ParsedProfile
from app.models import Application, Candidate, Company, Job, User

RESUME = b"Alex Candidate\nPython developer with five years building APIs and SQL data pipelines. Led reliable software delivery."


def account(client, email="alex@example.com", role="candidate", company_name="Acme", company_id=None):
    code = ""
    if role == "recruiter":
        from app.services.workspaces import issue_invite
        with client.test_session_factory() as db:
            if company_id is None:
                company = Company(name=company_name)
                db.add(company)
                db.flush()
                company_id = company.id
            code = issue_invite(db, company_id, email)
            db.commit()
    response = client.post("/api/auth/register", json={"email": email, "password": "secret123", "full_name": "Alex", "role": role, "invite_code": code})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def job(session_factory, status="ready", title="Software Engineer"):
    with session_factory() as db:
        company = db.scalar(select(Company).where(Company.legacy_workspace.is_(True)))
        owner = db.scalar(select(User).where(User.email == "test-recruiter@example.com"))
        item = Job(company_id=company.id, creator_id=owner.id, title=title, brief="Build Python systems", status=status, description={"markdown": "Build Python systems", "requirements": {"must_have_skills": ["Python"], "nice_to_have_skills": [], "min_years_experience": 2, "responsibilities": []}})
        db.add(item)
        db.commit()
        return item.id


def upload(client, headers):
    response = client.post("/api/portal/resumes", headers=headers, files={"file": ("resume.txt", RESUME, "text/plain")})
    assert response.status_code == 201
    return response.json()["id"]


def apply(client, headers, job_id, resume_id):
    response = client.post("/api/portal/applications", headers=headers, json={"job_id": job_id, "resume_id": resume_id})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_public_jobs_and_private_access(api, session_factory):
    client, _ = api()
    public = job(session_factory)
    draft = job(session_factory, "draft")
    headers = account(client)
    assert [j["id"] for j in client.get("/api/portal/jobs", headers={"Authorization": ""}).json()] == [public]
    assert client.get(f"/api/portal/jobs/{draft}").status_code == 404
    assert client.get("/api/portal/profile", headers={"Authorization": ""}).status_code == 401
    assert client.get("/api/portal/profile").status_code == 403
    for path in ("/api/candidates", "/api/jobs", "/api/interviews", "/api/dashboard", "/api/portal/hr/applications"):
        assert client.get(path, headers=headers).status_code == 403
    assert client.post("/api/candidates/apply-job", headers=headers).status_code == 403


def test_only_one_active_resume_and_replacement_preserves_applications(api, session_factory):
    client, _ = api()
    headers = account(client)
    resume = upload(client, headers)
    application = apply(client, headers, job(session_factory), resume)
    duplicate = client.post("/api/portal/resumes", headers=headers, files={"file": ("new.txt", RESUME)})
    assert duplicate.status_code == 409
    assert [r["id"] for r in client.get("/api/portal/resumes", headers=headers).json()] == [resume]
    other = account(client, "another@example.com")
    assert upload(client, other) != resume
    assert client.delete(f"/api/portal/resumes/{resume}", headers=other).status_code == 404
    assert client.delete(f"/api/portal/resumes/{resume}", headers=headers).status_code == 204
    replacement = upload(client, headers)
    assert replacement != resume
    assert [r["id"] for r in client.get("/api/portal/resumes", headers=headers).json()] == [replacement]
    assert client.get(f"/api/portal/applications/{application}", headers=headers).json()["resume_id"] == resume
    assert client.get(f"/api/portal/resumes/{resume}/download", headers=headers).content == RESUME


def test_simultaneous_resume_uploads_create_only_one_active_resume(api):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    client, _ = api()
    headers = account(client)
    barrier = Barrier(2)

    def send():
        barrier.wait(timeout=5)
        return client.post("/api/portal/resumes", headers=headers, files={"file": ("resume.txt", RESUME)}).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(send) for _ in range(2)]
        assert sorted(f.result(timeout=15) for f in futures) == [201, 409]
    assert len(client.get("/api/portal/resumes", headers=headers).json()) == 1


def test_profile_and_resume_ownership(api):
    client, _ = api()
    first = account(client)
    second = account(client, "other@example.com")
    profile = {"full_name": "Alex New", "current_position": "Developer", "skills": ["Python"], "bio": "Software engineer"}
    assert client.put("/api/portal/profile", headers=first, json=profile).status_code == 200
    assert client.get("/api/portal/profile", headers=first).json()["current_position"] == "Developer"
    assert client.get("/api/auth/me", headers=first).json()["full_name"] == "Alex New"
    resume = upload(client, first)
    assert client.get("/api/portal/resumes", headers=second).json() == []
    assert client.get(f"/api/portal/resumes/{resume}/download", headers=second).status_code == 404
    assert client.delete(f"/api/portal/resumes/{resume}", headers=second).status_code == 404
    assert client.get(f"/api/portal/resumes/{resume}/download", headers=first).content == RESUME
    invalid = client.post("/api/portal/resumes", headers=first, files={"file": ("resume.exe", RESUME)})
    assert invalid.status_code == 422


def test_application_snapshot_deduplication_and_job_specific_status(api, session_factory):
    client, _ = api()
    headers = account(client)
    other = account(client, "other@example.com")
    first_job, second_job = job(session_factory), job(session_factory, title="Data Engineer")
    resume = upload(client, headers)
    first = apply(client, headers, first_job, resume)
    second = apply(client, headers, second_job, resume)
    duplicate = client.post("/api/portal/applications", headers=headers, json={"job_id": first_job, "resume_id": resume})
    assert duplicate.status_code == 409
    assert client.post("/api/portal/applications", headers=other, json={"job_id": first_job, "resume_id": resume}).status_code == 422
    assert client.get(f"/api/portal/applications/{first}", headers=other).status_code == 404
    assert client.get("/api/portal/applications", headers=other).json() == []
    assert client.patch(f"/api/portal/hr/applications/{first}/status", json={"status": "interview", "note": "Interview scheduled"}).status_code == 200
    assert client.get(f"/api/portal/applications/{first}", headers=headers).json()["status"] == "interview"
    assert client.get(f"/api/portal/applications/{second}", headers=headers).json()["status"] == "applied"
    assert client.delete(f"/api/portal/resumes/{resume}", headers=headers).status_code == 204
    assert client.get("/api/portal/resumes", headers=headers).json() == []
    assert client.get(f"/api/portal/resumes/{resume}/download", headers=headers).content == RESUME
    assert client.delete(f"/api/jobs/{first_job}").status_code == 403
    candidate_id = client.get("/api/auth/me", headers=headers).json()["candidate_id"]
    assert client.delete(f"/api/candidates/{candidate_id}").status_code == 403
    assert client.post(f"/api/portal/applications/{first}/withdraw", headers=headers).status_code == 200
    assert client.patch(f"/api/portal/hr/applications/{first}/status", json={"status": "offer", "note": "Offer"}).status_code == 409


def test_two_way_messages_and_ownership(api, session_factory):
    client, _ = api()
    headers = account(client)
    other = account(client, "other@example.com")
    application = apply(client, headers, job(session_factory), upload(client, headers))
    path = f"/api/portal/applications/{application}/messages"
    assert client.post(path, headers=headers, json={"body": "What are the next steps?"}).status_code == 201
    assert client.post(path, json={"body": "We will arrange an interview."}).status_code == 201
    messages = client.get(path, headers=headers).json()
    assert [m["sender_role"] for m in messages] == ["candidate", "recruiter"]
    assert client.get(path, headers=other).status_code == 404
    assert client.post(path, headers=other, json={"body": "intrusion"}).status_code == 404
    assert client.post(path, headers=headers, json={"body": "   "}).status_code == 422


def test_message_notifications_are_scoped_persistent_and_race_safe(api, session_factory):
    client, _ = api()
    candidate = account(client)
    stranger = account(client, "stranger@example.com")
    coworker = account(client, "coworker@example.com", role="recruiter", company_id=client.get("/api/auth/me").json()["company_id"])
    application = apply(client, candidate, job(session_factory), upload(client, candidate))
    path = f"/api/portal/applications/{application}/messages"
    notifications = "/api/portal/message-notifications"
    sent = client.post(path, headers=candidate, json={"body": "Question for HR"}).json()["id"]
    assert client.get(notifications, headers=candidate).json()["unread_count"] == 0
    assert client.get(notifications).json()["unread_count"] == 1
    assert client.get(notifications, headers=coworker).json()["unread_count"] == 0
    assert client.get(notifications, headers=stranger).json()["unread_count"] == 0
    assert client.post(path + "/read", headers=coworker, json={"through_id": sent}).status_code == 404
    assert client.post(path + "/read", headers=stranger, json={"through_id": sent}).status_code == 404
    first = client.post(path, json={"body": "First reply"}).json()["id"]
    second = client.post(path, json={"body": "New arrival"}).json()["id"]
    assert client.get(notifications, headers=candidate).json()["unread_count"] == 2
    client.get(path, headers=candidate)
    assert client.get(notifications, headers=candidate).json()["unread_count"] == 2
    assert client.post(path + "/read", headers=candidate, json={"through_id": first}).status_code == 204
    unread = client.get(notifications, headers=candidate).json()
    assert unread["unread_count"] == 1 and unread["messages"][0]["id"] == second
    assert client.get(notifications).json()["unread_count"] == 1
    assert client.post(path + "/read", json={"through_id": second}).status_code == 204
    assert client.get(notifications).json()["unread_count"] == 0
    assert client.get(notifications, headers=candidate).json()["unread_count"] == 1
    assert client.get(notifications, headers={"Authorization": ""}).status_code == 401


def test_candidate_cannot_access_any_recruiter_api(api):
    client, _ = api()
    candidate = account(client)
    for path in ("dashboard", "company", "jobs", "jobs/1", "applicants", "applicants/1", "interviews", "interviews/1"):
        assert client.get(f"/api/recruiter/{path}", headers=candidate).status_code == 403
    for method, path in (("post", "jobs"), ("put", "jobs/1"), ("post", "jobs/1/close"), ("put", "company")):
        assert getattr(client, method)(f"/api/recruiter/{path}", headers=candidate, json={}).status_code == 403


def test_assessment_uses_submitted_resume_and_keeps_explanations(api, session_factory, monkeypatch):
    from app.routers import portal
    client, _ = api()
    headers = account(client)
    application = apply(client, headers, job(session_factory), upload(client, headers))
    monkeypatch.setattr(portal, "parse_resume", lambda text, llm: ParsedProfile(name="Alex", skills=["Python"], total_years_experience=5))
    def assess(**kwargs):
        assert kwargs["resume_text"] == RESUME.decode()
        return SimpleNamespace(overall_score=80, breakdown={"skills": 100, "semantic": 80, "experience": 60, "ai_review": 75}, summary="Strong Python experience", strengths=["Python"], gaps=["Domain experience"], evidence=[], skill_details=[], review_scores={}, confidence=0.8, dropped_quotes=0)
    monkeypatch.setattr(portal, "match_candidate", assess)
    response = client.post(f"/api/portal/applications/{application}/evaluate", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "applied"
    assert response.json()["assessment"] is None
    assert response.json()["private_assessment"]["overall_score"] == 80
    assert response.json()["screening_visibility"] == "private"
    with session_factory() as db:
        assert db.get(Application, application).assessment is None
        assert db.scalar(select(Candidate)).parsed_profile is None
    # Only the recruiter can publish an official assessment and change screening status.
    response = client.post(f"/api/portal/applications/{application}/evaluate")
    assert response.json()["status"] == "screened"
    assessment = response.json()["assessment"]
    assert assessment["weights"]["skills"] == pytest.approx(0.3)
    assert assessment["summary"] == "Strong Python experience"
    assert client.post(f"/api/portal/applications/{application}/evaluate", headers=headers).json()["assessment"] == assessment
    with session_factory() as db:
        assert len(list(db.scalars(select(Application)))) == 1
        assert db.scalar(select(Candidate)).resume_text == RESUME.decode()


def test_failed_assessment_does_not_lose_application(api, session_factory, monkeypatch):
    from app.llm.client import LLMError
    from app.routers import portal
    client, _ = api()
    headers = account(client)
    application = apply(client, headers, job(session_factory), upload(client, headers))
    def unavailable(*args):
        raise LLMError("Assessment service is temporarily unavailable")
    monkeypatch.setattr(portal, "parse_resume", unavailable)
    assert client.post(f"/api/portal/applications/{application}/evaluate", headers=headers).status_code == 502
    saved = client.get(f"/api/portal/applications/{application}", headers=headers).json()
    assert saved["status"] == "applied"
    assert saved["assessment"] is None
    assert len(saved["history"]) == 1
