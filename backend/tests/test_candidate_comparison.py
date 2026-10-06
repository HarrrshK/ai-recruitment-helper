from app.models import Application, CandidateProfile, Job, Resume, User
from app.services.resume_sections import resume_sections
from tests.test_candidate_portal import account, apply, upload
from tests.test_recruiter_workspace import create_job


def setup_comparison(client):
    hr = account(client, "compare-hr@example.com", "recruiter")
    job = create_job(client, hr)
    first = account(client, "compare-first@example.com")
    second = account(client, "compare-second@example.com")
    ids = [apply(client, candidate, job, upload(client, candidate)) for candidate in (first, second)]
    return hr, first, job, ids


def test_comparison_uses_application_evidence_and_profile_visibility(api, session_factory):
    client, _ = api()
    hr, candidate, job, ids = setup_comparison(client)
    assert client.get("/api/auth/me", headers=candidate).json()["public_id"]
    with session_factory() as db:
        application = db.get(Application, ids[0])
        resume = db.get(Resume, application.resume_id)
        resume.text = "Education\nBSc Computer Science\nProjects\nBuilt a Python API\nSkills\nPython"
        application.assessment = {"overall_score": 82, "job_revision": 1, "evidence": [
            {"claim": "API project", "quote": "Built a Python API"},
            {"claim": "Invented", "quote": "Five patents"}]}
        db.add(CandidateProfile(user_id=application.user_id, phone="PRIVATE", visible_fields=[]))
        db.get(Job, job).revision = 2
        db.commit()
    response = client.post("/api/recruiter/comparison", headers=hr, json={"job_id": job, "application_ids": ids})
    assert response.status_code == 200, response.text
    first = response.json()["candidates"][0]
    assert first["profile"]["phone"] == ""
    assert first["email"] == ""
    assert first["assessment_stale"] is True
    assert first["resume_sections"]["projects"] == ["Built a Python API"]
    assert first["resume_sections"]["education"] == ["BSc Computer Science"]
    assert first["assessment"]["evidence"] == [{"claim": "API project", "quote": "Built a Python API"}]
    assert first["interviews"] == []


def test_comparison_rejects_foreign_jobs_candidates_and_mixed_jobs(api, session_factory):
    client, _ = api()
    hr, candidate, job, ids = setup_comparison(client)
    body = {"job_id": job, "application_ids": ids}
    assert client.post("/api/recruiter/comparison", headers=candidate, json=body).status_code == 403
    with session_factory() as db:
        owner = db.get(User, db.get(Job, job).creator_id)
        company_id = owner.company_id
    colleague = account(client, "compare-colleague@example.com", "recruiter", company_id=company_id)
    assert client.post("/api/recruiter/comparison", headers=colleague, json=body).status_code == 404
    other_job = create_job(client, hr)
    third = account(client, "compare-third@example.com")
    other_id = apply(client, third, other_job, upload(client, third))
    assert client.post("/api/recruiter/comparison", headers=hr, json={**body, "application_ids": [ids[0], other_id]}).status_code == 422
    for invalid in ([ids[0]], [ids[0], ids[0]], [1, 2, 3, 4, 5]):
        assert client.post("/api/recruiter/comparison", headers=hr, json={**body, "application_ids": invalid}).status_code == 422
    with session_factory() as db:
        owner = db.get(User, db.get(Job, job).creator_id)
        owner.permissions = ["jobs.edit"]
        db.commit()
    assert client.post("/api/recruiter/comparison", headers=hr, json=body).status_code == 403


def test_sections_are_verbatim_and_absence_is_not_inferred():
    assert resume_sections("I studied Python and built projects.") == {"education": [], "experience": [], "projects": []}
    assert resume_sections("## PROJECTS\nBuilt APIs.\nEducation:\nDiploma\nSkills\nSQL")["projects"] == ["Built APIs."]


def test_legacy_accounts_receive_public_ids_on_first_migration(tmp_path, monkeypatch):
    from sqlalchemy import text
    from uuid import UUID
    from app import db as database

    engine = database.make_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR(200))"))
        conn.execute(text("INSERT INTO users (id, email) VALUES (1, 'first@example.com'), (2, 'second@example.com')"))
    monkeypatch.setattr(database, "engine", engine)
    database.init_db()
    with engine.connect() as conn:
        identifiers = list(conn.execute(text("SELECT public_id FROM users ORDER BY id")).scalars())
    assert len(set(identifiers)) == 2
    assert all(UUID(value) for value in identifiers)
    database.init_db()
    with engine.connect() as conn:
        assert list(conn.execute(text("SELECT public_id FROM users ORDER BY id")).scalars()) == identifiers
    engine.dispose()
