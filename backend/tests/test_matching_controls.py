from types import SimpleNamespace

from sqlalchemy import select

from app.agents.resume_parser import ParsedProfile
from app.models import Application, Candidate, Match
from app.services.matching_policy import DEFAULT_WEIGHTS, additional_signals, improvement_steps
from app.agents.jd_generator import JobRequirements
from tests.test_candidate_portal import account, apply, upload, job
from tests.test_recruiter_workspace import JOB


def test_weights_saved_validated_owned_and_revisioned(api):
    client, _ = api()
    weights = {**DEFAULT_WEIGHTS, "skills": 0.2, "projects": 0.1}
    created = client.post("/api/recruiter/jobs", json={**JOB, "matching_rules": weights})
    assert created.status_code == 201, created.text
    identifier = created.json()["id"]
    assert created.json()["matching_rules"] == weights
    changed = {**weights, "projects": 0.2, "skills": 0.1}
    saved = client.put(f"/api/recruiter/jobs/{identifier}", json={**JOB, "matching_rules": changed})
    assert saved.status_code == 200
    assert saved.json()["revision"] == created.json()["revision"] + 1
    for invalid in ({"unknown": 1}, {**weights, "skills": -0.1}, {**weights, "skills": 0}, {key: 0 for key in weights}):
        assert client.put(f"/api/recruiter/jobs/{identifier}", json={**JOB, "matching_rules": invalid}).status_code == 422
    other = account(client, "other-hr@example.com", role="recruiter")
    assert client.put(f"/api/recruiter/jobs/{identifier}", headers=other, json={**JOB, "matching_rules": changed}).status_code == 404
    candidate = account(client)
    assert client.put(f"/api/recruiter/jobs/{identifier}", headers=candidate, json={**JOB, "matching_rules": changed}).status_code == 403


def test_additional_signals_and_hypothetical_gain():
    profile = ParsedProfile(name="Alex", skills=["Python"], total_years_experience=1)
    requirements = JobRequirements(must_have_skills=["Python"], nice_to_have_skills=["SQL"], min_years_experience=2)
    assert additional_signals(requirements, profile, "Projects\nBuilt Python APIs\nEducation\nSQL course") == {"eligibility": 50, "projects": 50}
    assert additional_signals(requirements, profile, "No explicit project evidence")["projects"] == 0
    assert additional_signals(JobRequirements(), profile, "") == {"eligibility": None, "projects": None}
    steps = improvement_steps({"breakdown": {"skills": 40, "projects": 0, "experience": None}, "weights": {"skills": .5, "projects": .2}})
    assert [step["max_additional_points"] for step in steps] == [30, 20]


def test_candidate_screening_never_writes_hiring_data(api, session_factory, monkeypatch):
    client, _ = api()
    candidate = account(client)
    other = account(client, "other@example.com")
    resume = upload(client, candidate)
    application = apply(client, candidate, job(session_factory), resume)
    monkeypatch.setattr("app.routers.portal.parse_resume", lambda *args: ParsedProfile(name="Alex", skills=["Python"], total_years_experience=1))
    monkeypatch.setattr("app.routers.portal.match_candidate", lambda **kwargs: SimpleNamespace(overall_score=40, breakdown={"skills": 40}, summary="Needs more evidence", strengths=[], gaps=["Skill evidence"], evidence=[], skill_details=[], review_scores={}))
    path = f"/api/portal/applications/{application}/evaluate"
    assert client.post(path, headers=other).status_code == 404
    assert client.post(path + "?force=true", headers=candidate).status_code == 403
    result = client.post(path, headers=candidate).json()
    assert result["private_assessment"]["overall_score"] == 40
    assert result["private_improvement_steps"][0]["max_additional_points"] == 60
    assert result["assessment"] is None and result["status"] == "applied"
    with session_factory() as db:
        assert db.get(Application, application).assessment is None
        assert db.scalar(select(Match)) is None
        assert db.scalar(select(Candidate).where(Candidate.id == db.get(Application, application).candidate_id)).parsed_profile is None
    visible = client.get("/api/recruiter/applicants").json()[0]
    assert visible["assessment"] is None and "private_assessment" not in visible
    assert client.post(f"/api/portal/resume-screen?resume_id={resume}", headers=other).status_code == 404
    assert client.post(f"/api/portal/resume-screen?resume_id={resume}").status_code == 403


def test_private_recommendations_order_experience_and_exclude_closed_jobs(api, session_factory, monkeypatch):
    client, _ = api()
    candidate = account(client)
    resume = upload(client, candidate)
    junior = client.post("/api/recruiter/jobs", json={**JOB, "title": "Junior", "requirements": {"must_have_skills": ["Python"], "min_years_experience": 1}}).json()["id"]
    senior = client.post("/api/recruiter/jobs", json={**JOB, "title": "Senior", "requirements": {"must_have_skills": ["Python"], "min_years_experience": 10}}).json()["id"]
    client.post("/api/recruiter/jobs", json={**JOB, "status": "closed"})
    apply(client, candidate, junior, resume)
    monkeypatch.setattr("app.routers.portal.parse_resume", lambda *args: ParsedProfile(name="Alex", skills=["Python"], total_years_experience=1))
    results = client.post(f"/api/portal/resume-screen?resume_id={resume}", headers=candidate).json()
    assert [row["job"]["id"] for row in results] == [junior, senior]
    assert results[0]["recommendation_score"] == 100 and results[0]["already_applied"]
    assert results[1]["recommendation_score"] == 73 and results[1]["next_steps"]
    assert all(row["visibility"] == "private" for row in results)
    with session_factory() as db:
        assert db.scalar(select(Match)) is None


def test_project_weight_changes_actual_match(make_llm, embedder):
    import json
    from app.agents.matcher import match_candidate
    review = dict(skills_score=100, experience_score=100, domain_fit_score=100, strengths=[], gaps=[], evidence=[], summary="Evidence review", confidence=.8)
    llm, _ = make_llm([json.dumps(review)])
    result = match_candidate(job_title="Developer", requirements=JobRequirements(must_have_skills=["Python", "SQL"]), profile=ParsedProfile(name="Alex"), resume_text="Projects\nBuilt a Python API", llm=llm, embedder=embedder, custom_weights={key: float(key == "projects") for key in DEFAULT_WEIGHTS})
    assert result.breakdown["projects"] == result.overall_score == 50
