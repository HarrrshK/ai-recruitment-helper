from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import create_access_token, get_current_user, hash_password, verify_password
from app.db import get_db
from app.models import Candidate, User
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


class AuthUserResponse(BaseModel):
    id: int
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

    token = create_access_token({"sub": str(user.id), "role": user.role, "email": user.email})
    return AuthTokenResponse(
        access_token=token,
        user=AuthUserResponse(
            id=user.id,
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

    token = create_access_token({"sub": str(user.id), "role": role, "email": user.email, "ver": user.token_version or 0})
    return AuthTokenResponse(
        access_token=token,
        user=AuthUserResponse(
            id=user.id,
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
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        candidate_id=user.candidate_id,
        company_id=user.company_id,
        permissions=permissions_for(user) if user.role == "recruiter" else [],
        impersonation_id=getattr(user, "impersonation_id", None),
    )
