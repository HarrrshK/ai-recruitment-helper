from typing import Literal
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from hashlib import sha256
import secrets
import smtplib
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.auth import create_access_token, get_current_user, hash_password, verify_password
from app.config import get_settings
from app.db import get_db
from app.models import Candidate, PasswordResetToken, User
from app.services.workspaces import consume_invite, invite_permissions
from app.services.permissions import STAFF_ROLES, permissions_for

router = APIRouter(prefix="/api/auth", tags=["Auth"])


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str = ""
    role: str = "recruiter"  # "recruiter" | "candidate"
    invite_code: str = ""


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    role: Literal["recruiter", "candidate", "developer", "superadmin"] | None = None
    remember_me: bool = False


class AuthUserResponse(BaseModel):
    id: int
    public_id: str
    email: str
    full_name: str
    role: str
    candidate_id: int | None = None
    company_id: int | None = None
    permissions: list[str] = []
    impersonation_id: str | None = None


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: AuthUserResponse


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str = Field(min_length=32, max_length=128)
    password: str = Field(min_length=12, max_length=256)


def _send_reset_email(to: str, token: str) -> None:
    settings = get_settings()
    if not all((settings.smtp_host, settings.smtp_from)):
        raise HTTPException(503, "Password recovery is not configured. Please contact your workspace administrator.")
    base_url = settings.frontend_base_url.rstrip("/")
    url = f"{base_url}/reset-password?{urlencode({'token': token})}"
    message = EmailMessage()
    message["Subject"] = "Reset your AI Recruiter password"
    message["From"] = settings.smtp_from
    message["To"] = to
    message.set_content(f"Use this one-time link within 60 minutes to reset your password:\n\n{url}\n\nIf you did not request this, you can ignore this email.")
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
            if settings.smtp_use_tls:
                server.starttls()
            if settings.smtp_user:
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        raise HTTPException(503, "Password recovery email could not be sent. Please try again later.") from exc


@router.post("/register", response_model=AuthTokenResponse)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    """Register a new recruiter or candidate account."""
    if body.role not in ("recruiter", "candidate"):
        raise HTTPException(status_code=400, detail="Role must be 'recruiter' or 'candidate'")
    
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    existing_user = db.scalar(select(User).where(User.email == body.email.lower().strip()))
    if existing_user:
        raise HTTPException(status_code=400, detail="User with this email already exists")

    # If candidate role, create corresponding Candidate record if full_name is provided
    candidate_id = None
    company_id = None
    if body.role == "recruiter":
        company_id = consume_invite(db, body.invite_code, body.email)
    if body.role == "candidate":
        candidate = Candidate(
            name=body.full_name or body.email.split("@")[0],
            email=body.email.lower().strip(),
            stage="applied",
        )
        db.add(candidate)
        db.flush()
        candidate_id = candidate.id

    user = User(
        email=body.email.lower().strip(),
        password_hash=hash_password(body.password),
        full_name=body.full_name,
        role=body.role,
        candidate_id=candidate_id,
        company_id=company_id,
        permissions=invite_permissions(db, body.invite_code) if body.role == "recruiter" else None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": str(user.id), "role": user.role, "email": user.email, "sid": user.session_key})
    return AuthTokenResponse(
        access_token=token,
        user=AuthUserResponse(
            id=user.id,
            public_id=user.public_id,
            email=user.email,
            full_name=user.full_name,
            role=user.role,
            candidate_id=user.candidate_id,
            company_id=user.company_id,
            permissions=permissions_for(user) if user.role == "recruiter" else [],
        ),
    )


@router.post("/login", response_model=AuthTokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate with email and password."""
    user = db.scalar(select(User).where(User.email == body.email.lower().strip()))
    if not user or user.disabled or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    role = body.role or user.role
    from app.services import admin_operations
    if admin_operations.maintenance and role not in STAFF_ROLES:
        raise HTTPException(503, "Workspace maintenance is in progress. Please try again shortly.")
    if role in STAFF_ROLES:
        if user.role not in STAFF_ROLES or (role == "superadmin" and user.role != "superadmin"):
            raise HTTPException(403, "Developer access required")
        role = user.role
    if role == "recruiter" and user.role != "recruiter":
        raise HTTPException(status_code=403, detail="This account does not have HR / Company access. Sign in as a candidate.")
    if role == "candidate" and user.candidate_id is None:
        candidate = Candidate(name=user.full_name or user.email.split("@")[0], email=user.email, stage="applied")
        db.add(candidate)
        db.flush()
        user.candidate_id = candidate.id
        db.commit()
        db.refresh(user)

    expires = timedelta(days=30) if body.remember_me else None
    token = create_access_token({"sub": str(user.id), "role": role, "email": user.email, "ver": user.token_version or 0, "sid": user.session_key}, expires_delta=expires)
    return AuthTokenResponse(
        access_token=token,
        user=AuthUserResponse(
            id=user.id,
            public_id=user.public_id,
            email=user.email,
            full_name=user.full_name,
            role=role,
            candidate_id=user.candidate_id,
            company_id=user.company_id,
            permissions=permissions_for(user) if role == "recruiter" else [],
        ),
    )


@router.get("/me", response_model=AuthUserResponse)
def get_me(user: User = Depends(get_current_user)):
    """Retrieve current user session info."""
    return AuthUserResponse(
        id=user.id,
        public_id=user.public_id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        candidate_id=user.candidate_id,
        company_id=user.company_id,
        permissions=permissions_for(user) if user.role == "recruiter" else [],
        impersonation_id=getattr(user, "impersonation_id", None),
    )


@router.post("/password-reset/request", status_code=202)
def request_password_reset(body: PasswordResetRequest, db: Session = Depends(get_db)):
    """Send a one-time recovery link without revealing whether an account exists."""
    settings = get_settings()
    if not all((settings.smtp_host, settings.smtp_from)):
        raise HTTPException(503, "Password recovery is not configured. Please contact your workspace administrator.")
    email = body.email.lower().strip()
    user = db.scalar(select(User).where(User.email == email))
    if user and not user.disabled:
        now = datetime.now(UTC)
        recent = db.scalar(select(func.count()).select_from(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id, PasswordResetToken.requested_at >= now - timedelta(hours=1)
        )) or 0
        if recent < 3:
            secret = secrets.token_urlsafe(36)
            digest = sha256(secret.encode()).hexdigest()
            for old in db.scalars(select(PasswordResetToken).where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))):
                old.used_at = now
            db.add(PasswordResetToken(user_id=user.id, token_hash=digest, expires_at=now + timedelta(minutes=60)))
            db.commit()
            try:
                _send_reset_email(user.email, secret)
            except HTTPException:
                row = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == digest))
                if row:
                    row.used_at = datetime.now(UTC)
                    db.commit()
                raise
    return {"message": "If an account matches that email, a password reset link will be sent."}


@router.post("/password-reset/confirm")
def confirm_password_reset(body: PasswordResetConfirm, db: Session = Depends(get_db)):
    digest = sha256(body.token.encode()).hexdigest()
    reset = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == digest).with_for_update())
    now = datetime.now(UTC)
    expires = reset.expires_at.replace(tzinfo=UTC) if reset and reset.expires_at.tzinfo is None else reset.expires_at if reset else now
    if not reset or reset.used_at or expires <= now:
        raise HTTPException(400, "This password reset link is invalid or expired. Request a new link.")
    user = db.get(User, reset.user_id)
    if not user:
        raise HTTPException(400, "This password reset link is invalid or expired. Request a new link.")
    claimed = db.execute(update(PasswordResetToken).where(
        PasswordResetToken.id == reset.id, PasswordResetToken.used_at.is_(None), PasswordResetToken.expires_at > now
    ).values(used_at=now))
    if claimed.rowcount != 1:
        db.rollback()
        raise HTTPException(400, "This password reset link is invalid or expired. Request a new link.")
    user.password_hash = hash_password(body.password)
    user.token_version = (user.token_version or 0) + 1
    user.session_key = secrets.token_hex(24)
    db.commit()
    return {"message": "Password updated. Sign in with your new password."}
