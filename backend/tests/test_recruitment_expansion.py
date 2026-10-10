import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.agents.jd_generator import JobRequirements
from app.agents.matcher import match_candidate
from app.agents.resume_parser import ParsedProfile
from app.models import AuditLog, User
from app.services.skills import assess_skills
from tests.test_candidate_portal import account, apply, upload
from tests.test_job_drafts import INPUT, PLAN
from tests.test_recruiter_workspace import JOB


def test_groq_and_configured_drafting(api, make_llm, monkeypatch):
    client, _ = api()
    selected = []
    def factory(_, provider):
        selected.append(provider)
        return make_llm([json.dumps(PLAN)])[0]
    monkeypatch.setattr("app.llm.job_drafts.configured_draft_client", factory)
    for provider in ("groq", "configured"):
        response = client.post("/api/recruiter/jobs/generate", json={**INPUT, "provider": provider})
        assert response.status_code == 200, response.text
        assert response.json()["provider"] == provider
    assert selected == ["groq", "configured"]


def test_aliases_dedup_required_wins_over_preferred():
    requirements = JobRequirements(must_have_skills=["Postgres", "PostgreSQL"], nice_to_have_skills=["psql", "Docker"])
    assert requirements.must_have_skills == ["Postgres"]
    assert requirements.nice_to_have_skills == ["Docker"]
    details, score = assess_skills(requirements.must_have_skills, requirements.nice_to_have_skills, ParsedProfile(name="Alex", skills=["PostgreSQL"]))
    assert details[0].status == "listed" and details[0].kind == "must"
    assert details[1].status == "missing" and details[1].kind == "nice"


def test_unspecified_requirements_not_scored(make_llm, embedder):
    review = dict(skills_score=80, experience_score=80, domain_fit_score=80, strengths=[], gaps=[], evidence=[], summary="Evidence", confidence=.8)
    llm, _ = make_llm([json.dumps(review)])
    result = match_candidate(job_title="Developer", requirements=JobRequirements(), profile=ParsedProfile(name="Alex"), resume_text="A resume", llm=llm, embedder=embedder, custom_weights={"skills": .1, "semantic": .1, "experience": .1, "ai_review": .3, "projects": .2, "education": .2})
    assert result.breakdown["education"] is None and result.breakdown["projects"] is None
    assert result.breakdown["experience"] is None and result.breakdown["skills"] is None
    assert result.overall_score == 80


def test_job_terms_and_deadline_enforcement(api):
    client, _ = api()
    terms = {"salary_min": 500000, "salary_max": 900000, "salary_currency": "INR", "openings": 3, "deadline": (datetime.now(UTC) + timedelta(days=2)).isoformat()}
    created = client.post("/api/recruiter/jobs", json={**JOB, **terms})
    assert created.status_code == 201, created.text
    identifier = created.json()["id"]
    public = client.get(f"/api/portal/jobs/{identifier}").json()
    for key in terms:
        assert public[key] == created.json()[key]
    for bad in ({"salary_min": 5, "salary_max": 1}, {"openings": 0}, {"deadline": "2030-01-01T12:00:00"}):
        assert client.post("/api/recruiter/jobs", json={**JOB, **bad}).status_code == 422
    assert client.put(f"/api/recruiter/jobs/{identifier}", json={**JOB, **terms, "deadline": (datetime.now(UTC) - timedelta(days=1)).isoformat()}).status_code == 200
    assert client.get("/api/portal/jobs").json() == []
    headers = account(client)
    assert client.post("/api/portal/applications", headers=headers, json={"job_id": identifier, "resume_id": upload(client, headers)}).status_code == 409


def test_team_invites_permissions_no_escalation_and_audit(api, session_factory):
    client, _ = api()
    assert client.get("/api/recruiter/company/team").status_code == 403
    with session_factory() as db:
        manager = db.scalar(select(User).where(User.email == "test-recruiter@example.com"))
        manager.permissions = ["company.edit", "jobs.create"]
        company_id = manager.company_id
        manager_id = manager.id
        db.commit()
    assert client.get("/api/recruiter/company/team").status_code == 200
    path = "/api/recruiter/company/team/invites"
    assert client.post(path, json={"email": "new@example.com", "permissions": ["interviews.manage"]}).status_code == 403
    response = client.post(path, json={"email": "new@example.com", "permissions": ["jobs.create"], "days": 2})
    assert response.status_code == 201
    assert response.json()["code"]
    invitation = client.get("/api/recruiter/company/team").json()["invites"][0]
    assert "code" not in invitation and "token_hash" not in invitation
    member_headers = account(client, "member@example.com", "recruiter", company_id=company_id)
    member_id = client.get("/api/auth/me", headers=member_headers).json()["id"]
    # A manager with fewer privileges cannot edit a more privileged member.
    assert client.put(f"/api/recruiter/company/team/{member_id}/permissions", json={"permissions": []}).status_code == 403
    assert client.put(f"/api/recruiter/company/team/{manager_id}/permissions", json={"permissions": []}).status_code == 403
    assert client.get("/api/recruiter/company/team", headers=member_headers).status_code == 403
    assert client.delete(f"{path}/{invitation['id']}").status_code == 204
    with session_factory() as db:
        actions = list(db.scalars(select(AuditLog.action)))
        assert "company.invite_member" in actions and "company.invite_revoked" in actions


def test_interview_duration_calendar_and_privacy(api):
    client, _ = api()
    candidate = account(client)
    other = account(client, "other@example.com")
    job_id = client.post("/api/recruiter/jobs", json=JOB).json()["id"]
    application_id = apply(client, candidate, job_id, upload(client, candidate))
    body = {"title": "Technical", "scheduled_at": "2030-01-01T10:00:00+05:30", "duration_minutes": 90, "status": "scheduled", "location": "Video call"}
    interview = client.post(f"/api/recruiter/applicants/{application_id}/interviews", json=body)
    assert interview.status_code == 201, interview.text
    identifier = interview.json()["id"]
    path = f"/api/portal/interviews/{identifier}/calendar"
    response = client.get(path, headers=candidate)
    assert "DTSTART:20300101T043000Z" in response.text
    assert "DTEND:20300101T060000Z" in response.text and "BEGIN:VALARM" in response.text
    assert client.get(path, headers=other).status_code == 404
    assert client.put(f"/api/recruiter/interviews/{identifier}", json={**body, "duration_minutes": 0}).status_code == 422
    assert client.put(f"/api/recruiter/interviews/{identifier}", json={**body, "status": "cancelled"}).status_code == 200
    assert client.get(path, headers=candidate).status_code == 409
