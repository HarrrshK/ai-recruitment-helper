import hashlib
import os
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import BACKEND_DIR, get_settings
from app.db import get_db
from app.models import ImpersonationSession, User
from app.services.permissions import STAFF_ROLES, permissions_for
from app.services.signing_key import signing_key

# Secret key for JWT signing
SECRET_KEY = signing_key(get_settings().jwt_secret, BACKEND_DIR / "data" / ".jwt_secret")
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
    request: Request = None,
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
    try:
        user_id = int(payload["sub"])
    except (ValueError, TypeError):
        raise HTTPException(401, "Invalid authentication token")
    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if user.disabled or payload.get("ver", 0) != (user.token_version or 0) or payload.get("sid") != user.session_key:
        raise HTTPException(401, "Access revoked. Please sign in again.")
    principal = session_user(user, payload)
    if payload.get("imp"):
        session = db.get(ImpersonationSession, payload["imp"])
        actor = db.get(User, session.actor_id) if session else None
        if not session or session.revoked or session.user_id != user.id or session.expires_at.replace(tzinfo=UTC) <= datetime.now(UTC) or not actor or actor.disabled or actor.role not in STAFF_ROLES or (actor.token_version or 0) != session.actor_version:
            raise HTTPException(401, "Impersonation session ended")
        principal.impersonation_id = session.id
        principal.actor_id = actor.id
        if request and request.method not in ("GET", "HEAD", "OPTIONS"):
            from app.services.audit import record
            record(db, actor, "impersonation.action_requested", user.id, {"session": session.id, "method": request.method, "path": request.url.path})
            db.commit()
    return principal


def session_user(user: User, payload: dict[str, Any]) -> User:
    role = payload.get("role", user.role)
    if role not in (*STAFF_ROLES, "recruiter", "candidate") or (role != "candidate" and role != user.role):
        raise HTTPException(status_code=403, detail="Role access denied")
    # A detached principal keeps the session role from changing the account role.
    return User(id=user.id, public_id=user.public_id, email=user.email, full_name=user.full_name,
                role=role, candidate_id=user.candidate_id, company_id=user.company_id,
                permissions=user.permissions, disabled=user.disabled, token_version=user.token_version, session_key=user.session_key)


def get_optional_user(
    auth: HTTPAuthorizationCredentials | None = Depends(security_bearer),
    db: Session = Depends(get_db),
) -> User | None:
    """Optional user dependency returning User or None if unauthenticated."""
    if not auth or not auth.credentials:
        return None
    try:
        return get_current_user(auth, db)
    except HTTPException:
        return None


def require_recruiter(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    """Require user to have role='recruiter'."""
    if user.role != "recruiter":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Recruiter access required",
        )
    if user.company_id:
        from app.models import Company
        company = db.get(Company, user.company_id)
        if not company or company.active is False:
            raise HTTPException(403, "Company workspace is suspended")
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
    raise HTTPException(403, "This shared endpoint is retired. Use your recruiter workspace.")


def require_developer(user: User = Depends(get_current_user)) -> User:
    if user.role not in STAFF_ROLES or getattr(user, "impersonation_id", None):
        raise HTTPException(403, "Developer access required")
    return user


def require_superadmin(user: User = Depends(require_developer)) -> User:
    if user.role != "superadmin":
        raise HTTPException(403, "Superadmin access required")
    return user
