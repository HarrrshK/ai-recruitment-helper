import hashlib
import os
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import Company, User

# Secret key for JWT signing
SECRET_KEY = getattr(get_settings(), "jwt_secret", "hr-recruitment-ai-system-secret-key-2026")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24 * 7  # 7 days

security_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    """Hash password using PBKDF2-HMAC-SHA256 with random salt."""
    salt = os.urandom(16)
    pw_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
    return f"{salt.hex()}:{pw_hash.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify stored password against provided plaintext password."""
    try:
        salt_hex, pw_hash_hex = stored_hash.split(":")
        salt = bytes.fromhex(salt_hex)
        expected_hash = bytes.fromhex(pw_hash_hex)
        computed_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
        return computed_hash == expected_hash
    except Exception:
        return False


def create_access_token(data: dict[str, Any], expires_delta: timedelta | None = None) -> str:
    """Generate JWT access token containing claims."""
    to_encode = data.copy()
    now = datetime.now(UTC)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire, "iat": now})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any] | None:
    """Decode and validate a JWT access token."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None


def get_current_user(
    auth: HTTPAuthorizationCredentials | None = Depends(security_bearer),
    db: Session = Depends(get_db),
) -> User:
    """FastAPI dependency to extract and validate authenticated User."""
    if not auth or not auth.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_access_token(auth.credentials)
    if not payload or "sub" not in payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user_id = int(payload["sub"])
    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return session_user(user, payload)


def session_user(user: User, payload: dict[str, Any]) -> User:
    role = payload.get("role", user.role)
    if role not in ("recruiter", "candidate") or (role == "recruiter" and user.role != "recruiter"):
        raise HTTPException(status_code=403, detail="Role access denied")
    # A detached principal keeps the session role from changing the account role.
    return User(id=user.id, email=user.email, full_name=user.full_name,
                role=role, candidate_id=user.candidate_id, company_id=user.company_id)


def get_optional_user(
    auth: HTTPAuthorizationCredentials | None = Depends(security_bearer),
    db: Session = Depends(get_db),
) -> User | None:
    """Optional user dependency returning User or None if unauthenticated."""
    if not auth or not auth.credentials:
        return None
    payload = decode_access_token(auth.credentials)
    if not payload or "sub" not in payload:
        return None
    try:
        user_id = int(payload["sub"])
        user = db.scalar(select(User).where(User.id == user_id))
        return session_user(user, payload) if user else None
    except Exception:
        return None


def require_recruiter(user: User = Depends(get_current_user)) -> User:
    """Require user to have role='recruiter'."""
    if user.role != "recruiter":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Recruiter access required",
        )
    return user


def require_candidate(user: User = Depends(get_current_user)) -> User:
    """Require user to have role='candidate'."""
    if user.role != "candidate":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Candidate access required",
        )
    return user


def require_legacy_recruiter(user: User = Depends(require_recruiter), db: Session = Depends(get_db)) -> User:
    company = db.get(Company, user.company_id) if user.company_id else None
    # The old global endpoints cannot safely serve a multi-company installation.
    other_company = db.scalar(select(Company.id).where(Company.id != user.company_id).limit(1))
    if not company or not company.legacy_workspace or other_company:
        raise HTTPException(403, "Use the company-scoped recruiter workspace")
    return user
