import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.auth import get_current_user, require_recruiter


def test_hr_can_use_both_roles_without_changing_account(api, session_factory):
    client, _ = api()
    credentials = {"email": "hr@example.com", "password": "secret123"}
    from tests.test_candidate_portal import account
    account(client, "hr@example.com", "recruiter")
    candidate = client.post("/api/auth/login", json={**credentials, "role": "candidate"})
    assert candidate.status_code == 200
    data = candidate.json()
    assert data["user"]["role"] == "candidate"
    assert data["user"]["candidate_id"] is not None
    headers = {"Authorization": f"Bearer {data['access_token']}"}
    assert client.get("/api/auth/me", headers=headers).json()["role"] == "candidate"
    with session_factory() as db:
        principal = get_current_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials=data["access_token"]), db)
        with pytest.raises(HTTPException) as error:
            require_recruiter(principal)
        assert error.value.status_code == 403
    again = client.post("/api/auth/login", json={**credentials, "role": "candidate"}).json()
    assert again["user"]["candidate_id"] == data["user"]["candidate_id"]
    hr = client.post("/api/auth/login", json={**credentials, "role": "recruiter"})
    assert hr.status_code == 200
    assert hr.json()["user"]["role"] == "recruiter"
    assert client.get("/api/auth/me", headers=headers).json()["role"] == "candidate"
    assert client.post("/api/auth/login", json=credentials).json()["user"]["role"] == "recruiter"


def test_candidate_cannot_request_company_access(api):
    client, _ = api()
    credentials = {"email": "candidate@example.com", "password": "secret123"}
    assert client.post("/api/auth/register", json={**credentials, "role": "candidate"}).status_code == 200
    assert client.post("/api/auth/login", json={**credentials, "role": "recruiter"}).status_code == 403
    assert client.post("/api/auth/login", json={**credentials, "role": "admin"}).status_code == 422
    assert client.post("/api/auth/login", json={**credentials, "password": "wrong", "role": "candidate"}).status_code == 401
