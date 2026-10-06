import pytest
from sqlalchemy import event, select, text

from app.models import Application, AuditLog, Candidate, Company, Job, Resume, RuntimeConfig, User
from app.services import admin_operations as operations
from app.services.audit import install_guards
from app.services.platform_operations import labels_for, save_labels
from tests.test_candidate_portal import account, apply, job, upload
from tests.test_dev_console import staff

BASE = "/api/dev/operations"


@pytest.fixture(autouse=True)
def isolated(monkeypatch, session_factory):
    monkeypatch.setattr(operations, "maintenance", False)
    monkeypatch.setattr(operations, "cleanup_running", False)
    monkeypatch.setattr(operations, "active_requests", 0)
    engine = session_factory.kw["bind"]
    engine.dispose()
    @event.listens_for(engine, "connect")
    def constraints(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
    install_guards(engine)


def preview(client, admin, **selection):
    result = client.post(f"{BASE}/preview", headers=admin, json=selection)
    assert result.status_code == 200, result.text
    return result.json()


def execute(client, admin, plan, **extra):
    return client.post(f"{BASE}/execute", headers=admin, json={"token": plan["token"], "confirmation": plan["confirmation"],
        "password": "secret123", "reason": "Platform regression test", "backup_confirmed": True, **extra})


def seed(client, admin):
    result = client.post(f"{BASE}/seed", headers=admin, json={"candidates": 2, "kind": "TEST", "reason": "Seed isolated fixtures"})
    assert result.status_code == 201, result.text
    return result.json()


@pytest.mark.parametrize("role", ["candidate", "recruiter", "developer"])
def test_superadmin_only(api, role):
    client, _ = api()
    headers = staff(client, "developer")[0] if role == "developer" else account(client, f"{role}@example.com", role)
    for path in ("overview", "records/users", "records/users/1", "resumes/1/download", "health", "integrity", "sessions"):
        assert client.get(f"{BASE}/{path}", headers=headers).status_code == 403
    for path, body in (("preview", {"action": "test_reset"}), ("execute", {}), ("seed", {}), ("records/candidates/1/rerun", {"reason": "Try bypass"})):
        assert client.post(f"{BASE}/{path}", headers=headers, json=body).status_code == 403


def test_inspection_filters_and_no_credentials(api, session_factory):
    client, _ = api()
    admin, _ = staff(client)
    person = account(client)
    identity = client.get("/api/auth/me", headers=person).json()
    app_id = apply(client, person, job(session_factory), upload(client, person))
    response = client.get(f"{BASE}/records/users/{identity['id']}", headers=admin)
    assert response.status_code == 200, response.text
    assert response.json()["related"]["applications"]["rows"][0]["id"] == app_id
    assert response.json()["related"]["candidate_resumes"]["rows"][0]["size_bytes"] > 0
    assert "password_hash" not in response.text and "session_key" not in response.text
    rows = client.get(f"{BASE}/records/users?q={identity['public_id']}&role=candidate&status=active&kind=REAL", headers=admin).json()
    assert rows["total"] == 1
    assert rows["rows"][0]["id"] == identity["id"]
    assert client.get(f"{BASE}/records/users?since=2099-01-01T00:00:00Z", headers=admin).json()["total"] == 0
    assert client.get(f"{BASE}/records/password_reset_tokens", headers=admin).status_code == 404
    assert client.get(f"{BASE}/integrity", headers=admin).json()["foreign_key_orphans"] == []


def test_reset_account_preserves_identity_profile_and_revokes_sessions(api, session_factory):
    client, _ = api()
    admin, _ = staff(client)
    person = account(client)
    identity = client.get("/api/auth/me", headers=person).json()
    apply(client, person, job(session_factory), upload(client, person))
    plan = preview(client, admin, action="reset", resource="users", record_id=identity["id"])
    assert "delete:users" not in plan["counts"] and plan["bytes"] > 0
    assert execute(client, admin, plan).status_code == 409
    operations.maintenance = True
    result = execute(client, admin, plan)
    assert result.status_code == 200, result.text
    operations.maintenance = False
    assert client.get("/api/auth/me", headers=person).status_code == 401
    with session_factory() as db:
        user = db.get(User, identity["id"])
        assert user.public_id == identity["public_id"]
        assert user.candidate_id == identity["candidate_id"]
        assert db.get(Candidate, user.candidate_id)
        assert not list(db.scalars(select(Application)))
        assert not list(db.scalars(select(Resume)))
        assert not db.execute(text("PRAGMA foreign_key_check")).all()
        assert db.scalar(select(AuditLog).where(AuditLog.action == "platform.reset"))


def test_delete_resume_removes_binary_and_dependent_application(api, session_factory):
    client, _ = api()
    admin, _ = staff(client)
    person = account(client)
    resume_id = upload(client, person)
    app_id = apply(client, person, job(session_factory), resume_id)
    plan = preview(client, admin, action="delete", resource="resumes", record_id=resume_id)
    assert plan["counts"]["delete:applications"] == 1
    operations.maintenance = True
    result = execute(client, admin, plan)
    assert result.status_code == 200, result.text
    with session_factory() as db:
        assert db.get(Resume, resume_id) is None and db.get(Application, app_id) is None
        assert not db.execute(text("PRAGMA foreign_key_check")).all()


def test_test_reset_preserves_all_real_data(api, session_factory):
    client, _ = api()
    admin, _ = staff(client)
    real = account(client, "real@example.com")
    real_job = job(session_factory)
    real_resume = upload(client, real)
    real_app = apply(client, real, real_job, real_resume)
    seeded = seed(client, admin)
    plan = preview(client, admin, action="test_reset", test_only=True)
    operations.maintenance = True
    result = execute(client, admin, plan)
    assert result.status_code == 200, result.text
    with session_factory() as db:
        assert db.get(Application, real_app) and db.get(Resume, real_resume) and db.get(Job, real_job)
        assert db.get(Company, seeded["company_id"]) is None
        assert labels_for(db) == {}
        assert not db.execute(text("PRAGMA foreign_key_check")).all()


def test_test_reset_refuses_real_dependents(api, session_factory):
    client, _ = api()
    admin, _ = staff(client)
    seed_data = seed(client, admin)
    real = account(client, "real@example.com")
    with session_factory() as db:
        target = db.scalar(select(Job).where(Job.company_id == seed_data["company_id"]))
        target.status = "ready"
        db.get(User, target.creator_id).disabled = False
        db.commit()
        target_id = target.id
    apply(client, real, target_id, upload(client, real))
    response = client.post(f"{BASE}/preview", headers=admin, json={"action": "test_reset", "test_only": True})
    assert response.status_code == 409 and "REAL" in response.text
    assert "applications" in response.json()["detail"]["blocked_records"]
    with session_factory() as db:
        assert db.get(Company, seed_data["company_id"])


def test_stale_preview_confirmation_rollback_and_audit(api, session_factory, monkeypatch):
    client, _ = api()
    admin, _ = staff(client)
    person = account(client)
    key = client.get("/api/auth/me", headers=person).json()["id"]
    plan = preview(client, admin, action="reset", resource="users", record_id=key)
    operations.maintenance = True
    assert execute(client, admin, plan, confirmation="yes").status_code == 422
    assert execute(client, admin, plan, password="wrong").status_code == 403
    with session_factory() as db:
        db.get(User, key).full_name = "Changed after preview"
        db.commit()
    assert execute(client, admin, plan).status_code == 409
    fresh = preview(client, admin, action="reset", resource="users", record_id=key)
    def fail(*_):
        raise RuntimeError("simulated write failure")
    monkeypatch.setattr("app.routers.platform_operations.apply_updates", fail)
    with pytest.raises(RuntimeError):
        execute(client, admin, fresh)
    with session_factory() as db:
        assert db.get(User, key)
        assert db.scalar(select(AuditLog).where(AuditLog.action == "platform.reset.failed"))
        assert not db.scalar(select(AuditLog).where(AuditLog.action == "platform.executed"))


def test_sessions_registration_controls_and_single_use_preview(api):
    client, _ = api()
    admin, _ = staff(client)
    person = account(client)
    plan = preview(client, admin, action="revoke_all_sessions")
    operations.maintenance = True
    assert execute(client, admin, plan).status_code == 200
    assert execute(client, admin, plan).status_code == 409
    disabled = preview(client, admin, action="registrations", value="disabled")
    assert execute(client, admin, disabled).status_code == 200
    operations.maintenance = False
    assert client.get("/api/auth/me", headers=person).status_code == 401
    assert client.get("/api/auth/me", headers=admin).status_code == 200
    assert client.post("/api/auth/register", json={"email": "new@example.com", "password": "secret123", "role": "candidate"}).status_code == 503


def test_application_override_is_explicitly_audited(api, session_factory):
    client, _ = api()
    admin, admin_id = staff(client)
    person = account(client)
    key = apply(client, person, job(session_factory), upload(client, person))
    plan = preview(client, admin, action="status", resource="applications", record_id=key, value="shortlisted")
    operations.maintenance = True
    assert execute(client, admin, plan).status_code == 200
    with session_factory() as db:
        app = db.get(Application, key)
        assert app.status == "shortlisted"
        assert f"Superadmin override by #{admin_id}" in app.history[-1]["note"]


def test_labels_do_not_survive_reused_user_ids(api, session_factory):
    client, _ = api()
    admin, _ = staff(client)
    person = account(client)
    key = client.get("/api/auth/me", headers=person).json()["id"]
    with session_factory() as db:
        save_labels(db, {f"users:{key}": "TEST"})
        db.commit()
        assert labels_for(db)[f"users:{key}"] == "TEST"
        db.delete(db.get(User, key))
        db.flush()
        db.add(User(id=key, email="replacement@example.com", password_hash="unused", role="candidate"))
        db.commit()
        assert f"users:{key}" not in labels_for(db)


def test_failed_ai_operation_audited_and_retryable(api, session_factory):
    client, _ = api(["not json"] * 3)
    admin, _ = staff(client)
    person = account(client)
    identity = client.get("/api/auth/me", headers=person).json()
    response = client.post(f"{BASE}/records/candidates/{identity['candidate_id']}/rerun", headers=admin, json={"reason": "Retry selected analysis"})
    assert response.status_code == 502
    with session_factory() as db:
        assert db.scalar(select(AuditLog).where(AuditLog.action == "platform.rerun.failed"))


def test_health_safe_configuration(api, monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr("httpx.get", lambda *args, **kwargs: SimpleNamespace(status_code=200))
    client, _ = api()
    admin, _ = staff(client)
    result = client.get(f"{BASE}/health", headers=admin)
    assert result.status_code == 200, result.text
    assert result.json()["resume_upload_limit_bytes"] == 5 * 1024 * 1024
    assert "api_key" not in result.text and "password" not in result.text
