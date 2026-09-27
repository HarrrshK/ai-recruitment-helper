from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DatabaseError

from app.auth import create_access_token, hash_password
from app.models import AuditLog, Company, DevTask, ImpersonationSession, LLMEvent, PromptVersion, RuntimeConfig, User
from tests.test_candidate_portal import account


def staff(client, role="superadmin", email="admin@example.com"):
    with client.test_session_factory() as db:
        user = User(email=email, full_name="Test administrator", password_hash=hash_password("secret123"), role=role)
        db.add(user)
        db.commit()
        return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'role': role, 'sid': user.session_key})}"}, user.id


def test_interrupted_maintenance_can_be_retried(api):
    from app.services.dev_tasks import recover_interrupted_tasks
    client, _ = api()
    with client.test_session_factory() as db:
        db.add(DevTask(kind="benchmark"))
        db.commit()
    recover_interrupted_tasks(client.test_session_factory)
    with client.test_session_factory() as db:
        task = db.scalar(select(DevTask))
        assert task.status == "failed"
        assert task.result["error"] == "WorkerRestarted"


def test_stream_fallback_uses_its_own_model_and_never_replays_partial_output():
    from app.llm.client import LLMError
    from app.llm.runtime import RuntimeLLM
    calls = []
    class Stream:
        def __init__(self, partial=False, failing=False):
            self.partial, self.failing = partial, failing
        def stream(self, **kwargs):
            calls.append(kwargs)
            if self.partial:
                yield "partial"
            if self.failing:
                raise LLMError("provider unavailable")
            yield "fallback"
    runtime = RuntimeLLM(None)
    runtime._clients = lambda: [Stream(failing=True), Stream()]
    assert list(runtime.stream(model="primary-only-model")) == ["fallback"]
    assert calls == [{"model": "primary-only-model"}, {}]
    calls.clear()
    runtime._clients = lambda: [Stream(partial=True, failing=True), Stream()]
    response = runtime.stream(model="primary-only-model")
    assert next(response) == "partial"
    with pytest.raises(LLMError):
        next(response)
    assert len(calls) == 1


def test_all_developer_surfaces_reject_recruiters_and_candidates(api):
    client, _ = api()
    candidate = account(client)
    for path in ("overview", "companies", "users", "invites", "llm/config", "prompts", "prompts/matcher", "telemetry", "errors", "database", "database/users", "vectors", "tasks", "audit"):
        for headers in (candidate, dict(client.headers), {"Authorization": ""}):
            assert client.get(f"/api/dev/{path}", headers=headers).status_code in (401, 403), path
    for path in ("cache/flush", "tasks/benchmark", "synthetic"):
        assert client.post(f"/api/dev/{path}", json={}, headers=candidate).status_code == 403
    assert client.post("/api/auth/register", json={"email": "intruder@example.com", "password": "secret123", "role": "superadmin"}).status_code == 400


def test_company_crud_knowledge_and_invite_permissions(api):
    client, _ = api()
    admin, _ = staff(client)
    created = client.post("/api/dev/companies", headers=admin, json={"name": "Managed company", "website": "https://example.com"})
    assert created.status_code == 201, created.text
    company_id = created.json()["id"]
    knowledge = client.post(f"/api/dev/companies/{company_id}/knowledge", headers=admin, files={"file": ("company_info.md", b"# Company\nRemote work supported.", "text/markdown")})
    assert knowledge.status_code == 200
    assert client.post(f"/api/dev/companies/{company_id}/knowledge", headers=admin, files={"file": ("../secret.exe", b"bad")}).status_code == 422
    invite = client.post("/api/dev/invites", headers=admin, json={"company_id": company_id, "email": "member@example.com", "permissions": ["company.edit"]}).json()
    member = client.post("/api/auth/register", json={"email": "member@example.com", "password": "secret123", "role": "recruiter", "invite_code": invite["code"]})
    assert member.status_code == 200
    headers = {"Authorization": f"Bearer {member.json()['access_token']}"}
    assert member.json()["user"]["permissions"] == ["company.edit"]
    assert client.put("/api/recruiter/company", headers=headers, json={"name": "Member updated"}).status_code == 200
    from tests.test_recruiter_workspace import JOB
    assert client.post("/api/recruiter/jobs", headers=headers, json=JOB).status_code == 403
    assert client.delete(f"/api/dev/companies/{company_id}", headers=admin).status_code == 409
    assert client.put(f"/api/dev/companies/{company_id}", headers=admin, json={"name": "Managed company", "active": False}).status_code == 200
    assert client.get("/api/recruiter/company", headers=headers).status_code == 403
    events = client.get("/api/dev/audit", headers=admin).json()
    assert {e["action"] for e in events} >= {"company.create", "company.knowledge", "invite.create", "company.member_edit"}
    assert invite["code"] not in str(events)


def test_rbac_revokes_old_sessions_and_prevents_privilege_escalation(api):
    client, _ = api()
    admin, admin_id = staff(client)
    dev, dev_id = staff(client, "developer", "developer@example.com")
    candidate = account(client)
    candidate_id = client.get("/api/auth/me", headers=candidate).json()["id"]
    assert client.patch(f"/api/dev/users/{candidate_id}", headers=dev, json={"role": "superadmin", "reason": "Escalate"}).status_code == 403
    assert client.patch(f"/api/dev/users/{admin_id}", headers=admin, json={"role": "candidate", "reason": "Self lockout"}).status_code == 409
    assert client.patch(f"/api/dev/users/{candidate_id}", headers=dev, json={"role": "candidate", "disabled": True, "reason": "Revoke account"}).status_code == 200
    assert client.get("/api/auth/me", headers=candidate).status_code == 401
    assert client.post("/api/auth/login", json={"email": "alex@example.com", "password": "secret123", "role": "candidate"}).status_code == 401
    response = client.post("/api/auth/login", json={"email": "admin@example.com", "password": "secret123", "role": "developer"})
    assert response.status_code == 200 and response.json()["user"]["role"] == "superadmin"


def test_impersonation_is_bounded_scoped_revocable_and_audited(api, session_factory):
    client, _ = api()
    admin, _ = staff(client)
    candidate = account(client)
    target = client.get("/api/auth/me", headers=candidate).json()["id"]
    session = client.post(f"/api/dev/users/{target}/impersonate", headers=admin, json={"role": "candidate", "reason": "Investigate profile issue"})
    assert session.status_code == 200, session.text
    body = session.json()
    support = {"Authorization": f"Bearer {body['access_token']}"}
    assert client.get("/api/auth/me", headers=support).json()["impersonation_id"]
    assert client.get("/api/dev/users", headers=support).status_code == 403
    assert client.put("/api/portal/profile", headers=support, json={"full_name": "Support edit"}).status_code == 200
    assert client.get("/api/dev/audit?action=impersonation.action_requested", headers=admin).json()
    assert client.delete(f"/api/dev/impersonations/{body['user']['impersonation_id']}", headers=admin).status_code == 204
    assert client.get("/api/auth/me", headers=support).status_code == 401
    assert client.get("/api/auth/me", headers=admin).status_code == 200


def test_prompt_versions_diff_and_live_testing(api, monkeypatch):
    client, _ = api(["Test answer"])
    admin, _ = staff(client)
    original = client.get("/api/dev/prompts/matcher", headers=admin).json()
    saved = client.put("/api/dev/prompts/matcher", headers=admin, json={"content": "A new test system prompt.", "note": "Test revision", "revision": original["revision"]})
    assert saved.status_code == 200
    assert client.put("/api/dev/prompts/matcher", headers=admin, json={"content": "Another stale update.", "note": "Stale change", "revision": 0}).status_code == 409
    diff = client.post("/api/dev/prompts/matcher/diff", headers=admin, json={"left": "old", "right": "new"}).json()
    assert diff[0] == {"kind": "replace", "left": "old", "right": "new"}
    tested = client.post("/api/dev/prompts/matcher/test", headers=admin, json={"content": "You are a test assistant.", "input": "Synthetic resume"})
    assert tested.status_code == 200 and tested.json()["output"] == "Test answer"
    assert client.get("/api/dev/prompts/qa_bot.md", headers=admin).status_code == 200
    assert client.get("/api/dev/prompts/not_a_prompt", headers=admin).status_code == 404
    from app import db as database
    from app.prompts import load_prompt
    monkeypatch.setattr(database, "SessionLocal", client.test_session_factory)
    assert load_prompt("matcher") == "A new test system prompt."


def test_runtime_config_cache_isolation_and_telemetry(api, monkeypatch):
    client, _ = api()
    admin, _ = staff(client)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-not-for-output")
    body = {"primary": {"provider": "openai", "large_model": "test-large", "small_model": "test-small", "cost_per_million": 2}, "fallback": {"provider": "ollama", "large_model": "local", "small_model": "local"}, "revision": 0}
    response = client.put("/api/dev/llm/config", headers=admin, json=body)
    assert response.status_code == 200, response.text
    assert "test-key-not-for-output" not in response.text
    assert client.put("/api/dev/llm/config", headers=admin, json=body).status_code == 409
    from app.llm.runtime import RuntimeLLM
    runtime = RuntimeLLM(client.test_session_factory)
    clients = runtime._clients()
    assert clients[0].settings.llm_base_url == "https://api.openai.com/v1"
    assert clients[0].settings.llm_api_key == "test-key-not-for-output"
    assert runtime._clients()[0] is clients[0]
    args = ("chat", "same", [{"role": "user", "content": "same"}], .2, None)
    assert clients[0]._cache_key(*args) != clients[1]._cache_key(*args)
    clients[0]._begin("test-agent", "test-large")
    clients[0]._event("rate_limit", "HTTP 429 retry")
    clients[0]._log_run("test-agent", "test-large", "hash", "output", 100, 500, False)
    telemetry = client.get("/api/dev/telemetry", headers=admin).json()
    assert telemetry["agents"][0]["tokens"] == 100
    assert telemetry["agents"][0]["cost"] == pytest.approx(.0002)
    assert client.get("/api/dev/errors?kind=rate_limit", headers=admin).json()[0]["kind"] == "rate_limit"


def test_inspector_hides_secrets_and_audit_is_append_only(api, session_factory):
    client, _ = api()
    admin, _ = staff(client)
    rows = client.get("/api/dev/database/users", headers=admin).json()
    assert "password_hash" not in rows["columns"]
    assert client.get("/api/dev/database/no_such_table", headers=admin).status_code == 404
    assert client.get("/api/dev/database/users?offset=-1", headers=admin).status_code == 422
    from app.services.audit import install_guards
    install_guards(session_factory.kw["bind"])
    with session_factory() as db:
        with pytest.raises(DatabaseError):
            db.execute(text("DELETE FROM audit_logs"))


def test_benchmark_and_synthetic_are_isolated_and_reproducible(api):
    client, _ = api()
    admin, _ = staff(client)
    from app.services.dev_tasks import benchmark
    result = benchmark()
    assert result["total"] == result["passed"] == 127
    first = client.post("/api/dev/synthetic", headers=admin, json={"candidates": 5, "jobs": 2, "seed": 7}).json()
    second = client.post("/api/dev/synthetic", headers=admin, json={"candidates": 5, "jobs": 2, "seed": 7}).json()
    assert first == second and len(first["candidates"]) == 5
    assert client.post("/api/dev/synthetic", headers=admin, json={"candidates": 10000}).status_code == 422
    assert client.get("/api/dev/vectors", headers=admin).json()["chroma"] == "Not configured"
