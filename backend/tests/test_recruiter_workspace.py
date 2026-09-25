from types import SimpleNamespace

from sqlalchemy import select

from app.agents.interviewer import Question
from app.agents.resume_parser import ParsedProfile
from app.models import Application, Company, HiringInterview, Job, User
from tests.test_candidate_portal import account, apply, upload

JOB = {"title": "Platform Engineer", "brief": "Build Python services", "markdown": "Build and maintain reliable Python APIs.", "status": "ready", "requirements": {"must_have_skills": ["Python"], "nice_to_have_skills": ["SQL"], "min_years_experience": 2, "responsibilities": ["Build APIs"]}}


def recruiter(client, email="hiring@example.com", name="Acme"):
    headers = account(client, email, "recruiter")
    response = client.put("/api/recruiter/company", headers=headers, json={"name": name, "industry": "Technology", "website": "https://example.com"})
    assert response.status_code == 200, response.text
    return headers


def create_job(client, headers, **changes):
    response = client.post("/api/recruiter/jobs", headers=headers, json={**JOB, **changes})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def applicant(client, hr, email="person@example.com"):
    candidate = account(client, email)
    job_id = create_job(client, hr)
    application_id = apply(client, candidate, job_id, upload(client, candidate))
    return candidate, job_id, application_id


def test_company_job_lifecycle_and_tenant_boundaries(api):
    client, _ = api()
    first = recruiter(client)
    second = recruiter(client, "other-hr@example.com", "Other company")
    candidate = account(client)
    draft = create_job(client, first, status="draft")
    live = create_job(client, first)
    assert client.get("/api/recruiter/jobs", headers=second).json() == []
    for method, path, body in [("get", f"/api/recruiter/jobs/{live}", None), ("put", f"/api/recruiter/jobs/{live}", JOB), ("post", f"/api/recruiter/jobs/{live}/close", None)]:
        assert client.request(method, path, headers=second, json=body).status_code == 404
    public = client.get("/api/portal/jobs").json()
    assert [job["id"] for job in public] == [live]
    assert public[0]["company_name"] == "Acme"
    assert client.get(f"/api/portal/jobs/{draft}").status_code == 404
    assert client.get("/api/recruiter/dashboard", headers=candidate).status_code == 403
    assert client.get("/api/jobs", headers=first).status_code == 403
    application_id = apply(client, candidate, live, upload(client, candidate))
    assert client.post(f"/api/recruiter/jobs/{live}/close", headers=first).status_code == 200
    assert client.get(f"/api/portal/jobs/{live}").status_code == 404
    assert client.get(f"/api/portal/applications/{application_id}", headers=candidate).status_code == 200
    other_candidate = account(client, "new-person@example.com")
    resume = upload(client, other_candidate)
    assert client.post("/api/portal/applications", headers=other_candidate, json={"job_id": live, "resume_id": resume}).status_code == 409


def test_applicants_rank_decisions_and_resume_scope(api, session_factory):
    client, _ = api()
    hr = recruiter(client)
    other = recruiter(client, "other-hr@example.com")
    candidate, job_id, first_id = applicant(client, hr)
    second_candidate = account(client, "second@example.com")
    second_id = apply(client, second_candidate, job_id, upload(client, second_candidate))
    with session_factory() as db:
        db.get(Application, first_id).assessment = {"overall_score": 80, "job_revision": 1}
        db.get(Application, second_id).assessment = {"overall_score": 95, "job_revision": 1}
        db.commit()
    rows = client.get(f"/api/recruiter/applicants?job_id={job_id}", headers=hr).json()
    assert [(r["id"], r["rank"]) for r in rows] == [(second_id, 1), (first_id, 2)]
    assert client.get("/api/recruiter/applicants", headers=other).json() == []
    for path in (f"/api/recruiter/applicants/{first_id}", f"/api/recruiter/applicants/{first_id}/resume", f"/api/portal/applications/{first_id}", f"/api/portal/applications/{first_id}/messages"):
        assert client.get(path, headers=other).status_code == 404
    assert client.get(f"/api/recruiter/applicants/{first_id}/resume", headers=hr).status_code == 200
    assert client.post(f"/api/portal/applications/{first_id}/evaluate", headers=other).status_code == 404
    assert client.patch(f"/api/portal/hr/applications/{first_id}/status", headers=other, json={"status": "rejected", "note": "No"}).status_code == 404
    update = client.patch(f"/api/portal/hr/applications/{first_id}/status", headers=hr, json={"status": "shortlisted", "note": "Strong background for the role"})
    assert update.status_code == 200
    assert client.get(f"/api/portal/applications/{first_id}", headers=candidate).json()["history"][-1]["status"] == "shortlisted"
    dashboard = client.get("/api/recruiter/dashboard", headers=hr).json()
    assert dashboard["applications"] == 2
    assert dashboard["shortlisted"] == 1
    assert client.put(f"/api/recruiter/jobs/{job_id}", headers=hr, json={**JOB, "markdown": "New job requirements"}).status_code == 200
    rows = client.get("/api/recruiter/applicants", headers=hr).json()
    assert all(row["assessment_stale"] and row["rank"] is None for row in rows)
    assert client.post(f"/api/portal/applications/{first_id}/evaluate?force=true", headers=candidate).status_code == 403


def test_interview_schedule_questions_and_private_feedback(api, monkeypatch):
    from app.routers import recruiter as module
    client, _ = api()
    hr = recruiter(client)
    other = recruiter(client, "other-hr@example.com")
    candidate, _, application_id = applicant(client, hr)
    body = {"title": "Technical round", "interviewer": "Taylor", "status": "scheduled", "scheduled_at": "2030-10-10T10:00:00Z", "location": "https://meet.example.com/interview"}
    response = client.post(f"/api/recruiter/applicants/{application_id}/interviews", headers=hr, json=body)
    assert response.status_code == 201, response.text
    interview_id = response.json()["id"]
    assert client.get(f"/api/portal/applications/{application_id}", headers=candidate).json()["status"] == "interview"
    monkeypatch.setattr(module, "parse_resume", lambda *args: ParsedProfile(name="Alex", total_years_experience=5))
    calls = []
    def generate(**kwargs):
        calls.append(kwargs)
        return [Question(id=0, text="How would you design a reliable API?", competency="technical", difficulty="medium", good_answer_signals=["Discusses failure handling"])]
    monkeypatch.setattr(module, "generate_questions", generate)
    questions_path = f"/api/recruiter/interviews/{interview_id}/questions"
    assert client.post(questions_path, headers=other).status_code == 404
    generated = client.post(questions_path, headers=hr)
    assert generated.status_code == 200, generated.text
    assert generated.json()["questions"][0]["good_answer_signals"]
    assert client.post(questions_path, headers=hr).status_code == 200
    assert len(calls) == 1
    feedback = {"technical": 8, "problem_solving": 7, "communication": 9, "role_fit": 8, "recommendation": "hire", "notes": "Private interviewer notes", "candidate_feedback": "Strong API design discussion"}
    assert client.put(f"/api/recruiter/interviews/{interview_id}/feedback", headers=hr, json=feedback).status_code == 200
    assert client.put(f"/api/recruiter/interviews/{interview_id}", headers=hr, json={**body, "status": "completed"}).status_code == 200
    visible = client.get(f"/api/portal/applications/{application_id}/interviews", headers=candidate).json()[0]
    assert visible["status"] == "completed"
    assert visible["candidate_feedback"] == feedback["candidate_feedback"]
    assert "feedback" not in visible and "questions" not in visible
    assert client.get("/api/recruiter/interviews", headers=other).json() == []
    assert client.get(f"/api/recruiter/interviews/{interview_id}", headers=candidate).status_code == 403


def test_validation_and_withdrawn_application(api):
    client, _ = api()
    hr = recruiter(client)
    assert client.put("/api/recruiter/company", headers=hr, json={"name": "Company", "website": "javascript:alert(1)"}).status_code == 422
    assert client.post("/api/recruiter/jobs", headers=hr, json={**JOB, "markdown": ""}).status_code == 422
    assert client.post("/api/recruiter/jobs", headers=hr, json={**JOB, "requirements": {"min_years_experience": -1}}).status_code == 422
    candidate, _, application_id = applicant(client, hr)
    path = f"/api/recruiter/applicants/{application_id}/interviews"
    assert client.post(path, headers=hr, json={"title": "Interview", "status": "scheduled"}).status_code == 422
    assert client.post(path, headers=hr, json={"title": "Interview", "scheduled_at": "2030-01-01T10:00:00"}).status_code == 422
    client.post(f"/api/portal/applications/{application_id}/withdraw", headers=candidate)
    assert client.post(path, headers=hr, json={"title": "Interview"}).status_code == 409


def test_legacy_migration_is_idempotent(session_factory):
    from app.services.workspaces import migrate_shared_workspace
    with session_factory() as db:
        old_user = User(email="old@example.com", password_hash="test", role="recruiter")
        old_job = Job(title="Old job")
        db.add_all([old_user, old_job])
        db.commit()
        migrate_shared_workspace(db)
        migrate_shared_workspace(db)
        assert old_user.company_id == old_job.company_id
        assert len(list(db.scalars(select(Company)))) == 1


def test_question_generation_failure_keeps_interview(api, monkeypatch):
    from app.llm.client import LLMError
    from app.routers import recruiter as module
    client, _ = api()
    hr = recruiter(client)
    _, _, application_id = applicant(client, hr)
    interview = client.post(f"/api/recruiter/applicants/{application_id}/interviews", headers=hr, json={"title": "Technical interview"}).json()
    def failure(*args):
        raise LLMError("Temporarily unavailable")
    monkeypatch.setattr(module, "parse_resume", failure)
    assert client.post(f"/api/recruiter/interviews/{interview['id']}/questions", headers=hr).status_code == 502
    saved = client.get(f"/api/recruiter/interviews/{interview['id']}", headers=hr).json()
    assert saved["status"] == "planned" and saved["questions"] is None
