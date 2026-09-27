import pytest
from sqlalchemy import event, select, text

from app.auth import create_access_token, hash_password
from app.db import Base
from app.models import AuditLog, Candidate, Company, DevTask, HiringInterview, Job, Match, Message, PanelReview, RuntimeConfig, User
from app.services import admin_operations as operations
from app.services.audit import install_guards
from tests.test_candidate_portal import account, apply, job, upload
from tests.test_dev_console import staff


@pytest.fixture(autouse=True)
def isolated_operations(monkeypatch, session_factory):
    monkeypatch.setattr(operations, "maintenance", False)
    monkeypatch.setattr(operations, "cleanup_running", False)
    monkeypatch.setattr(operations, "active_requests", 0)
    engine = session_factory.kw["bind"]
    engine.dispose()
    @event.listens_for(engine, "connect")
    def enable_constraints(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
    install_guards(engine)


def user_body(email="created@example.com", role="candidate", **extra):
    return {"email": email, "full_name": "Managed account", "password": "initial-password-123", "role": role, "reason": "Administrator provisioning", **extra}


def preview(client, admin, **selection):
    response = client.post("/api/dev/cleanup/preview", headers=admin, json=selection)
    assert response.status_code == 200, response.text
    return response.json()


def execute(client, admin, plan, **extra):
    return client.post("/api/dev/cleanup/execute", headers=admin, json={"token": plan["token"], "confirmation": plan["confirmation"], "password": "secret123", "reason": "Isolated test cleanup", "backup_confirmed": True, **extra})


def pause(client, admin, enabled=True):
    response = client.put("/api/dev/maintenance", headers=admin, json={"enabled": enabled, "password": "secret123", "reason": "Isolated test maintenance"})
    assert response.status_code == 200, response.text


def test_managed_creation_role_boundaries_and_password_redaction(api):
    client, _ = api()
    admin, _ = staff(client)
    dev, _ = staff(client, "developer", "developer@example.com")
    company = client.post("/api/dev/companies", headers=admin, json={"name": "Provisioned company"}).json()["id"]
    for role in ("candidate", "recruiter", "developer", "superadmin"):
        body = user_body(f"{role}@managed.example.com", role, company_id=company if role == "recruiter" else None)
        response = client.post("/api/dev/users", headers=admin, json=body)
        assert response.status_code == 201, response.text
        assert body["password"] not in response.text
        if role == "candidate":
            assert response.json()["candidate_id"]
        assert client.post("/api/auth/login", json={"email": body["email"], "password": body["password"], "role": role}).status_code == 200
    assert client.post("/api/dev/users", headers=dev, json=user_body("privileged@example.com", "superadmin")).status_code == 403
    assert client.post("/api/dev/users", headers=dev, json=user_body("no-company@example.com", "recruiter")).status_code == 422
    assert client.post("/api/dev/users", headers=dev, json=user_body()).status_code == 201
    assert client.post("/api/dev/users", headers=dev, json=user_body()).status_code == 409
    audit = client.get("/api/dev/audit", headers=admin).text
    assert "initial-password-123" not in audit
    candidate = account(client, "forbidden@example.com")
    assert client.post("/api/dev/users", headers=candidate, json=user_body()).status_code == 403


def test_profile_password_and_session_controls(api):
    client, _ = api()
    admin, admin_id = staff(client)
    candidate = account(client)
    target = client.get("/api/auth/me", headers=candidate).json()["id"]
    response = client.patch(f"/api/dev/users/{target}/profile", headers=admin, json={"email": "renamed@example.com", "full_name": "New Name", "reason": "Correct account"})
    assert response.status_code == 200
    assert client.get("/api/auth/me", headers=candidate).status_code == 401
    logged = client.post("/api/auth/login", json={"email": "renamed@example.com", "password": "secret123", "role": "candidate"}).json()
    headers = {"Authorization": f"Bearer {logged['access_token']}"}
    body = {"password": "incorrect", "new_password": "changed-password-123", "reason": "Requested reset"}
    assert client.post(f"/api/dev/users/{target}/password", headers=admin, json=body).status_code == 403
    body["password"] = "secret123"
    assert client.post(f"/api/dev/users/{target}/password", headers=admin, json=body).status_code == 200
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    assert client.post("/api/auth/login", json={"email": "renamed@example.com", "password": "secret123"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "renamed@example.com", "password": "changed-password-123"}).status_code == 200
    assert client.post(f"/api/dev/users/{admin_id}/revoke-sessions", headers=admin, json={"reason": "Self lockout"}).status_code == 409
    assert "changed-password-123" not in client.get("/api/dev/audit", headers=admin).text


def test_candidate_deletion_cascades_and_does_not_reauthorize_reused_id(api, session_factory):
    client, _ = api()
    admin, _ = staff(client)
    candidate = account(client)
    identity = client.get("/api/auth/me", headers=candidate).json()
    application = apply(client, candidate, job(session_factory), upload(client, candidate))
    client.post(f"/api/portal/applications/{application}/messages", json={"body": "Private reply"})
    plan = preview(client, admin, user_id=identity["id"])
    assert plan["counts"]["applications"] == plan["counts"]["candidate_resumes"] == 1
    assert client.get("/api/auth/me", headers=candidate).status_code == 200
    assert execute(client, admin, plan, password="wrong").status_code == 403
    assert execute(client, admin, plan, confirmation="delete").status_code == 422
    assert execute(client, admin, plan, backup_confirmed=False).status_code == 422
    response = execute(client, admin, plan)
    assert response.status_code == 200, response.text
    assert execute(client, admin, plan).status_code == 409
    with session_factory() as db:
        assert db.get(User, identity["id"]) is None
        assert db.get(Candidate, identity["candidate_id"]) is None
        assert not db.execute(text("PRAGMA foreign_key_check")).all()
        replacement = User(id=identity["id"], email="replacement@example.com", password_hash=hash_password("new-password"), role="candidate")
        db.add(replacement)
        db.commit()
    assert client.get("/api/auth/me", headers=candidate).status_code == 401


def test_stale_preview_rejected_without_partial_deletion(api, session_factory):
    client, _ = api()
    admin, _ = staff(client)
    candidate = account(client)
    identity = client.get("/api/auth/me", headers=candidate).json()
    plan = preview(client, admin, user_id=identity["id"])
    upload(client, candidate)
    response = execute(client, admin, plan)
    assert response.status_code == 409 and "changed" in response.text
    assert client.get("/api/auth/me", headers=candidate).status_code == 200


def test_transfer_keeps_jobs_when_recruiter_is_deleted(api, session_factory):
    client, _ = api()
    admin, _ = staff(client)
    source = client.get("/api/auth/me").json()
    destination = account(client, "next-hr@example.com", "recruiter", company_id=source["company_id"])
    destination_id = client.get("/api/auth/me", headers=destination).json()["id"]
    job_id = job(session_factory)
    result = client.post(f"/api/dev/users/{source['id']}/transfer-jobs", headers=admin, json={"recruiter_id": destination_id, "reason": "Keep hiring continuity"})
    assert result.status_code == 200 and result.json()["transferred"] == 1
    plan = preview(client, admin, user_id=source["id"])
    assert "jobs" not in plan["counts"]
    assert execute(client, admin, plan).status_code == 200
    assert client.get(f"/api/recruiter/jobs/{job_id}", headers=destination).status_code == 200


def test_bulk_reset_requires_superadmin_maintenance_and_preserves_audit(api, session_factory):
    client, _ = api()
    admin, admin_id = staff(client)
    dev, dev_id = staff(client, "developer", "dev@example.com")
    candidate = account(client)
    application = apply(client, candidate, job(session_factory), upload(client, candidate))
    with session_factory() as db:
        db.add(HiringInterview(application_id=application))
        db.add(RuntimeConfig(key="llm", value={"test": True}))
        db.commit()
    assert client.post("/api/dev/cleanup/preview", headers=dev, json={"full_reset": True}).status_code == 403
    assert client.post("/api/dev/cleanup/preview", headers=admin, json={"groups": ["audit_logs"]}).status_code == 422
    assert client.post("/api/dev/cleanup/preview", headers=admin, json={"user_id": admin_id}).status_code == 409
    plan = preview(client, admin, full_reset=True)
    assert execute(client, admin, plan).status_code == 409
    pause(client, admin)
    assert client.get("/api/portal/jobs").status_code == 503
    assert client.post("/api/auth/register", json={}).status_code == 503
    assert client.post("/api/auth/login", json={"email": "alex@example.com", "password": "secret123", "role": "candidate"}).status_code == 503
    response = execute(client, admin, plan)
    assert response.status_code == 200, response.text
    with session_factory() as db:
        assert set(db.scalars(select(User.id))) == {admin_id, dev_id}
        assert db.scalar(select(AuditLog).where(AuditLog.action == "cleanup.executed"))
        assert db.get(RuntimeConfig, "maintenance").value["enabled"]
        assert db.get(RuntimeConfig, "llm") is None
        assert not db.execute(text("PRAGMA foreign_key_check")).all()
        for name, table in Base.metadata.tables.items():
            if name not in ("users", "audit_logs", "runtime_config"):
                assert db.execute(select(table)).first() is None, name
    assert client.get("/api/auth/me", headers=admin).status_code == 200
    pause(client, admin, False)
    assert client.get("/api/portal/jobs").json() == []


def test_single_job_cleanup_keeps_users_and_other_jobs(api, session_factory):
    client, _ = api()
    admin, _ = staff(client)
    candidate = account(client)
    first, second = job(session_factory), job(session_factory, title="Keep this job")
    application = apply(client, candidate, first, upload(client, candidate))
    with session_factory() as db:
        person = db.scalar(select(Candidate).where(Candidate.email == "alex@example.com"))
        match = Match(job_id=first, candidate_id=person.id)
        db.add(match)
        db.flush()
        db.add(PanelReview(match_id=match.id, persona="reviewer"))
        db.add(Message(candidate_id=person.id, job_id=first, kind="invite"))
        db.commit()
    plan = preview(client, admin, job_id=first)
    assert plan["counts"]["messages"] == plan["counts"]["panel_reviews"] == 1
    pause(client, admin)
    assert execute(client, admin, plan).status_code == 200
    pause(client, admin, False)
    assert client.get("/api/auth/me", headers=candidate).status_code == 200
    assert client.get(f"/api/recruiter/jobs/{second}").status_code == 200
    assert client.get(f"/api/recruiter/jobs/{first}").status_code == 404


def test_preview_cannot_be_reused_by_another_actor_or_while_tasks_run(api, session_factory):
    client, _ = api()
    admin, _ = staff(client)
    other, _ = staff(client, email="second-admin@example.com")
    candidate = account(client)
    target = client.get("/api/auth/me", headers=candidate).json()["id"]
    plan = preview(client, admin, user_id=target)
    assert execute(client, other, plan).status_code == 403
    with session_factory() as db:
        db.add(DevTask(kind="benchmark"))
        db.commit()
    response = execute(client, admin, plan)
    assert response.status_code == 409 and "tasks" in response.text


def test_staff_deletion_and_session_revoke_are_superadmin_only(api):
    client, _ = api()
    admin, admin_id = staff(client)
    dev, _ = staff(client, "developer", "developer@example.com")
    assert client.post("/api/dev/cleanup/preview", headers=dev, json={"user_id": admin_id}).status_code == 403
    assert client.post(f"/api/dev/users/{admin_id}/revoke-sessions", headers=dev, json={"reason": "Escalation attempt"}).status_code == 403
    target = client.post("/api/dev/users", headers=admin, json=user_body("logout@example.com")).json()
    login = client.post("/api/auth/login", json={"email": target["email"], "password": "initial-password-123"}).json()
    headers = {"Authorization": f"Bearer {login['access_token']}"}
    assert client.post(f"/api/dev/users/{target['id']}/revoke-sessions", headers=dev, json={"reason": "Security incident"}).status_code == 200
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_company_cleanup_detaches_staff_and_keeps_other_company(api, session_factory):
    client, _ = api()
    admin, admin_id = staff(client)
    source = client.get("/api/auth/me").json()
    job_id = job(session_factory)
    with session_factory() as db:
        db.get(User, admin_id).company_id = source["company_id"]
        survivor = Company(name="Unrelated company")
        db.add(survivor)
        db.commit()
        survivor_id = survivor.id
    plan = preview(client, admin, company_id=source["company_id"])
    assert plan["counts"]["companies"] == 1
    assert plan["detached_memberships"]["company_id"] == [admin_id]
    pause(client, admin)
    assert execute(client, admin, plan).status_code == 200
    with session_factory() as db:
        assert db.get(User, admin_id).company_id is None
        assert db.get(Company, survivor_id)
        assert db.get(Job, job_id) is None
        assert not db.execute(text("PRAGMA foreign_key_check")).all()


def test_confirmation_expiry_active_request_interlock_and_transaction_rollback(api, session_factory, monkeypatch):
    import jwt
    from datetime import UTC, datetime, timedelta
    from app.auth import ALGORITHM, SECRET_KEY
    from app.routers import dev_admin
    from fastapi import HTTPException
    client, _ = api()
    admin, _ = staff(client)
    candidate = account(client)
    target = client.get("/api/auth/me", headers=candidate).json()["id"]
    plan = preview(client, admin, user_id=target)
    payload = jwt.decode(plan["token"], SECRET_KEY, algorithms=[ALGORITHM], audience="database-cleanup")
    payload["exp"] = datetime.now(UTC) - timedelta(seconds=1)
    expired = {**plan, "token": jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)}
    assert execute(client, admin, expired).status_code == 409
    operations.active_requests = 1
    try:
        assert execute(client, admin, plan).status_code == 409
    finally:
        operations.active_requests = 0
    original = dev_admin.execute_plan
    def fail_after_deletion(db, selection):
        original(db, selection)
        raise HTTPException(409, "Simulated transaction failure")
    monkeypatch.setattr(dev_admin, "execute_plan", fail_after_deletion)
    assert execute(client, admin, plan).status_code == 409
    assert client.get("/api/auth/me", headers=candidate).status_code == 200
    with session_factory() as db:
        assert not db.scalar(select(AuditLog).where(AuditLog.action == "cleanup.executed"))


def test_maintenance_interlock_blocks_concurrent_workspace_and_admin_writes(api):
    from app.services.admin_operations import enter, leave
    client, _ = api()
    admin, _ = staff(client)
    pause(client, admin)
    operations.cleanup_running = True
    assert enter("/api/dev/users") is None
    assert enter("/api/portal/applications") is None
    assert enter("/api/dev/cleanup/execute") is False
    operations.cleanup_running = False
    assert enter("/api/dev/users") is True
    leave()
    assert client.get("/api/portal/jobs").status_code == 503
    pause(client, admin, False)


def test_user_search_and_filters(api):
    client, _ = api()
    admin, _ = staff(client)
    target = client.post("/api/dev/users", headers=admin, json=user_body()).json()
    assert [u["id"] for u in client.get("/api/dev/users?q=Managed&role=candidate&disabled=false", headers=admin).json()] == [target["id"]]
    assert client.get("/api/dev/users?role=candidate&disabled=true", headers=admin).json() == []
