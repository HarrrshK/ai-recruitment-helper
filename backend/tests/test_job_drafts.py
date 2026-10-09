import json

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.agents.job_draft import generate_draft
from app.config import Settings
from app.llm.client import LLMValidationError
from app.llm.job_drafts import job_draft_client
from app.models import Job, RuntimeConfig, User
from app.routers.recruiter import GenerateJobIn
from tests.test_candidate_portal import account


INPUT = {
    "title": "Backend Engineer", "brief": "Build our API", "location": "Bengaluru",
    "work_mode": "hybrid", "employment_type": "contract",
    "requirements": {"must_have_skills": ["Python", "SQL"], "nice_to_have_skills": ["Docker"],
                     "min_years_experience": 2, "education": "Equivalent experience accepted",
                     "responsibilities": ["Build APIs", "Review code"]},
}
PLAN = {"tone": "inviting", "required": [1, 0], "preferred": [0], "responsibilities": [0, 1]}


def test_grounded_structured_draft(make_llm):
    llm, fake = make_llm([json.dumps(PLAN)])
    result = generate_draft(GenerateJobIn(**INPUT), llm)
    assert result.requirements.model_dump() == INPUT["requirements"]
    assert result.provider == "ollama"
    assert "- SQL\n- Python" in result.markdown
    assert "Minimum experience: 2 years" in result.markdown
    assert "Equivalent experience accepted" in result.markdown
    assert "hybrid" in result.markdown and "contract" in result.markdown
    assert result.sections[2].source_fields == ["requirements.responsibilities"]
    assert "Bengaluru" in fake.completions.calls[0]["messages"][-1]["content"]


@pytest.mark.parametrize("changes", [
    {"required": [0, 2]}, {"required": [0, 0]}, {"responsibilities": []},
    {"education": "PhD"}, {"min_years_experience": 10}, {"tone": "Must have AWS"},
    {"required": [False, 1]},
])
def test_rejects_invention_omissions_and_malformed_plans(make_llm, changes):
    llm, _ = make_llm([json.dumps({**PLAN, **changes})] * 2)
    with pytest.raises(LLMValidationError):
        generate_draft(GenerateJobIn(**INPUT), llm)


def test_unspecified_fields_stay_absent(make_llm):
    llm, _ = make_llm([json.dumps({"tone": "direct", "required": [], "preferred": [], "responsibilities": []})])
    result = generate_draft(GenerateJobIn(title="Engineer", requirements={}), llm)
    assert not {"required", "preferred", "education", "responsibilities"} & {s.key for s in result.sections}
    assert "benefits" not in result.markdown.lower()


def test_generate_then_review_uses_existing_job_flow(api, make_llm, monkeypatch):
    client, _ = api()
    llm, _ = make_llm([json.dumps(PLAN)])
    monkeypatch.setattr("app.routers.recruiter.job_draft_client", lambda _: llm)
    response = client.post("/api/recruiter/jobs/generate", json=INPUT)
    assert response.status_code == 200, response.text
    draft = response.json()
    assert client.get("/api/recruiter/jobs").json() == []
    edited = draft["markdown"] + "\n\nRecruiter reviewed this role."
    created = client.post("/api/recruiter/jobs", json={**INPUT, "markdown": edited, "status": "draft"})
    assert created.status_code == 201, created.text
    assert created.json()["requirements"] == INPUT["requirements"]
    job_id = created.json()["id"]
    published = client.put(f"/api/recruiter/jobs/{job_id}", json={**INPUT, "markdown": edited, "status": "ready"})
    assert published.status_code == 200
    assert published.json()["markdown"] == edited
    with client.test_session_factory() as db:
        assert len(list(db.scalars(select(Job)))) == 1


def test_access_and_validation_before_model_call(api, monkeypatch):
    client, _ = api()
    def no_model(_):
        pytest.fail("Unauthorized/invalid request reached Ollama")
    monkeypatch.setattr("app.routers.recruiter.job_draft_client", no_model)
    candidate = account(client)
    assert client.post("/api/recruiter/jobs/generate", headers=candidate, json=INPUT).status_code == 403
    assert client.post("/api/recruiter/jobs/generate", headers={"Authorization": ""}, json=INPUT).status_code == 401
    for patch in ({"title": " "}, {"work_mode": "anywhere"}, {"requirements": {"min_years_experience": 61}},
                  {"requirements": {"must_have_skills": [" "]}}, {"requirements": {"education": "x" * 2001}}):
        assert client.post("/api/recruiter/jobs/generate", json={**INPUT, **patch}).status_code == 422
    with client.test_session_factory() as db:
        user = db.scalar(select(User).where(User.email == "test-recruiter@example.com"))
        user.permissions = ["messages.send"]
        db.commit()
    assert client.post("/api/recruiter/jobs/generate", json=INPUT).status_code == 403


def test_generation_failure_manual_still_works(api, make_llm, monkeypatch):
    client, _ = api()
    llm, _ = make_llm(["not JSON"] * 2)
    monkeypatch.setattr("app.routers.recruiter.job_draft_client", lambda _: llm)
    assert client.post("/api/recruiter/jobs/generate", json=INPUT).status_code == 502
    response = client.post("/api/recruiter/jobs", json={**INPUT, "markdown": "Manually written", "status": "ready"})
    assert response.status_code == 201


def test_ollama_routing_never_uses_cloud(session_factory, monkeypatch):
    config = Settings(_env_file=None, ollama_model="", llm_base_url="https://api.groq.com/openai/v1")
    monkeypatch.setattr("app.llm.job_drafts.Settings", lambda: config)
    import httpx
    def unavailable(*args, **kwargs):
        raise httpx.ConnectError("offline")
    monkeypatch.setattr("app.llm.job_drafts.httpx.get", unavailable)
    with pytest.raises(HTTPException) as error:
        job_draft_client(session_factory)
    assert error.value.status_code == 503
    with session_factory() as db:
        db.add(RuntimeConfig(key="llm", value={"primary": {"provider": "groq", "large_model": "cloud", "small_model": "cloud"},
                                              "fallback": {"provider": "ollama", "large_model": "local", "small_model": "local"}}))
        db.commit()
    client = job_draft_client(session_factory)
    assert client.provider == "ollama"
    assert client.settings.llm_model_small == "local"
    config.ollama_model = "explicit-local"
    assert job_draft_client(session_factory).settings.llm_model_small == "explicit-local"


def test_documented_ollama_env_configuration(session_factory, monkeypatch):
    config = Settings(_env_file=None, llm_base_url="http://localhost:11434/v1", llm_model_small="local-model")
    monkeypatch.setattr("app.llm.job_drafts.Settings", lambda: config)
    client = job_draft_client(session_factory)
    assert client.settings.llm_model_small == "local-model"
    assert client.settings.llm_api_key == "ollama"


def test_single_installed_ollama_discovery(session_factory, monkeypatch):
    from types import SimpleNamespace
    config = Settings(_env_file=None, ollama_model="", llm_base_url="https://api.groq.com/openai/v1", ollama_base_url="http://localhost:11434/v1")
    monkeypatch.setattr("app.llm.job_drafts.Settings", lambda: config)
    monkeypatch.setattr("app.llm.job_drafts.httpx.get", lambda *args, **kwargs: SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"models": [{"name": "local-model", "capabilities": ["completion"]}]}))
    client = job_draft_client(session_factory)
    assert client.provider == "ollama"
    assert client.settings.llm_model_small == "local-model"
    assert client.settings.llm_base_url == "http://localhost:11434/v1"


def test_refinement_does_not_change_supplied_requirements(make_llm):
    llm, fake = make_llm([json.dumps({**PLAN, "tone": "formal"})])
    draft = generate_draft(GenerateJobIn(**INPUT, refinement="Use a formal tone"), llm)
    assert draft.requirements.model_dump() == INPUT["requirements"]
    assert draft.generated_wording == "Position available:"
    assert "Use a formal tone" in fake.completions.calls[0]["messages"][-1]["content"]
