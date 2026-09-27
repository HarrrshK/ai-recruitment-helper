import secrets
from datetime import UTC, datetime, timedelta
from typing import Literal

import jwt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import ALGORITHM, SECRET_KEY, hash_password, require_developer, verify_password
from app.db import get_db
from app.models import AuditLog, Candidate, Company, DevTask, Job, RuntimeConfig, User
from app.routers.dev import InviteBody, user_out
from app.services import admin_operations as operations
from app.services.audit import record
from app.services.data_cleanup import GROUPS, build_plan, execute_plan, lock_database
from app.services.dev_tasks import task_lock
from app.services.permissions import DEFAULT_PERMISSIONS, STAFF_ROLES

router = APIRouter(prefix="/api/dev", tags=["administration"], dependencies=[Depends(require_developer)])


def superadmin(user):
    if user.role != "superadmin":
        raise HTTPException(403, "Superadmin access required")


def target_user(db, actor, user_id):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "User not found")
    if target.id == actor.id:
        raise HTTPException(409, "Use another administrator to modify this account")
    if target.role in STAFF_ROLES:
        superadmin(actor)
    return target


def reauthenticate(db, user, password):
    actor = db.get(User, user.id)
    if not actor or actor.disabled or actor.role != user.role or (actor.token_version or 0) != (user.token_version or 0):
        raise HTTPException(401, "Administrator session changed. Sign in again.")
    if not verify_password(password, actor.password_hash):
        raise HTTPException(403, "Administrator password is incorrect")
    return actor


class Reason(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class Reauthenticated(Reason):
    password: str = Field(min_length=1, max_length=500)


class CreateUser(Reason):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=12, max_length=200)
    role: Literal["candidate", "recruiter", "developer", "superadmin"]
    company_id: int | None = None
    permissions: list[str] = Field(default_factory=lambda: DEFAULT_PERMISSIONS.copy())
    _permissions = field_validator("permissions")(InviteBody.known_permissions.__func__)


@router.post("/users", status_code=201)
def create_user(body: CreateUser, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    if body.role in STAFF_ROLES:
        superadmin(user)
    if body.role == "recruiter":
        company = db.get(Company, body.company_id) if body.company_id else None
        if not company or company.active is False:
            raise HTTPException(422, "Select an active company for the recruiter")
    elif body.company_id is not None:
        raise HTTPException(422, "Only recruiter accounts can be assigned a company here")
    email = str(body.email).lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(409, "Email is already registered")
    target = User(email=email, full_name=body.full_name.strip(), role=body.role,
                  password_hash=hash_password(body.password), company_id=body.company_id,
                  permissions=body.permissions if body.role == "recruiter" else [])
    if not target.full_name:
        raise HTTPException(422, "Name is required")
    if body.role == "candidate":
        candidate = Candidate(name=target.full_name, email=email)
        db.add(candidate)
        db.flush()
        target.candidate_id = candidate.id
    db.add(target)
    try:
        db.flush()
        record(db, user, "user.create", target.id, {"email": email, "role": target.role, "company_id": target.company_id, "reason": body.reason})
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Email is already registered")
    return user_out(target)


class ProfileUpdate(Reason):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=200)


@router.patch("/users/{user_id}/profile")
def profile(user_id: int, body: ProfileUpdate, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    target = target_user(db, user, user_id)
    email = str(body.email).lower()
    if not body.full_name.strip():
        raise HTTPException(422, "Name is required")
    if db.scalar(select(User.id).where(User.email == email, User.id != user_id)):
        raise HTTPException(409, "Email is already registered")
    before = {"email": target.email, "full_name": target.full_name}
    target.email, target.full_name = email, body.full_name.strip()
    target.token_version = (target.token_version or 0) + 1
    candidate = db.get(Candidate, target.candidate_id) if target.candidate_id else None
    if candidate:
        candidate.email, candidate.name = email, target.full_name
    record(db, user, "user.profile", user_id, {"before": before, "after": {"email": email, "full_name": target.full_name}, "reason": body.reason})
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Email is already registered")
    return user_out(target)


@router.post("/users/{user_id}/revoke-sessions")
def revoke_sessions(user_id: int, body: Reason, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    target = target_user(db, user, user_id)
    target.token_version = (target.token_version or 0) + 1
    record(db, user, "user.revoke_sessions", target.id, {"reason": body.reason})
    db.commit()
    return {"revoked": True}


class ResetPassword(Reauthenticated):
    new_password: str = Field(min_length=12, max_length=200)


@router.post("/users/{user_id}/password")
def reset_password(user_id: int, body: ResetPassword, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    reauthenticate(db, user, body.password)
    target = target_user(db, user, user_id)
    target.password_hash = hash_password(body.new_password)
    target.token_version = (target.token_version or 0) + 1
    record(db, user, "user.reset_password", target.id, {"reason": body.reason})
    db.commit()
    return {"reset": True}


class TransferJobs(Reason):
    recruiter_id: int


@router.post("/users/{user_id}/transfer-jobs")
def transfer_jobs(user_id: int, body: TransferJobs, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    source = target_user(db, user, user_id)
    target = db.get(User, body.recruiter_id)
    if not target or target.id == source.id or target.role != "recruiter" or target.disabled or not target.company_id or target.company_id != source.company_id:
        raise HTTPException(422, "Choose a different active recruiter in the same company")
    result = db.execute(update(Job).where(Job.creator_id == source.id, Job.company_id == target.company_id).values(creator_id=target.id))
    record(db, user, "user.transfer_jobs", source.id, {"to": target.id, "jobs": result.rowcount, "reason": body.reason})
    db.commit()
    return {"transferred": result.rowcount}


@router.get("/maintenance")
def maintenance():
    with operations.lock:
        return {"enabled": operations.maintenance, "active_requests": operations.active_requests}


class MaintenanceBody(Reauthenticated):
    enabled: bool


@router.put("/maintenance")
def set_maintenance(body: MaintenanceBody, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    superadmin(user)
    reauthenticate(db, user, body.password)
    with operations.lock:
        row = db.get(RuntimeConfig, "maintenance")
        if row is None:
            row = RuntimeConfig(key="maintenance", value={})
            db.add(row)
        row.value = {"enabled": body.enabled}
        record(db, user, "maintenance.change", "workspace", {"enabled": body.enabled, "reason": body.reason})
        db.commit()
        operations.maintenance = body.enabled
    return maintenance()


@router.get("/cleanup/options")
def cleanup_options():
    return {"groups": list(GROUPS), "preserved": ["Staff accounts", "Audit history", "Maintenance setting", "Server secrets and files"]}


class CleanupSelection(BaseModel):
    groups: list[str] = Field(default_factory=list)
    user_id: int | None = Field(default=None, ge=1)
    company_id: int | None = Field(default=None, ge=1)
    job_id: int | None = Field(default=None, ge=1)
    full_reset: bool = False

    @field_validator("groups")
    @classmethod
    def known_groups(cls, value):
        if not set(value).issubset(GROUPS):
            raise ValueError("Unknown cleanup category")
        return sorted(set(value))


def selection_groups(body, user):
    targets = [value for value in (body.user_id, body.company_id, body.job_id) if value is not None]
    if targets:
        if len(targets) > 1 or body.groups or body.full_reset:
            raise HTTPException(422, "Choose one record or a bulk cleanup, not both")
        if body.user_id is None:
            superadmin(user)
        return []
    superadmin(user)
    groups = list(GROUPS) if body.full_reset else body.groups
    if not groups:
        raise HTTPException(422, "Select at least one category")
    return groups


@router.post("/cleanup/preview")
def preview_cleanup(body: CleanupSelection, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    groups = selection_groups(body, user)
    plan = build_plan(db, groups, user, body.user_id, body.company_id, body.job_id)
    nonce = secrets.token_hex(16)
    phrase = f"DELETE USER {body.user_id}" if body.user_id else "RESET APPLICATION DATA" if body.full_reset else "DELETE SELECTED DATA"
    if body.company_id or body.job_id:
        phrase = f"DELETE COMPANY {body.company_id}" if body.company_id else f"DELETE JOB {body.job_id}"
    expires = datetime.now(UTC) + timedelta(minutes=10)
    token = jwt.encode({"aud": "database-cleanup", "actor": user.id, "ver": user.token_version or 0, "sid": user.session_key,
        "selection": body.model_dump(), "digest": plan["digest"], "nonce": nonce, "phrase": phrase, "exp": expires}, SECRET_KEY, algorithm=ALGORITHM)
    record(db, user, "cleanup.preview", nonce, {"selection": body.model_dump(), "counts": plan["counts"]})
    db.commit()
    return {"token": token, "confirmation": phrase, "counts": plan["counts"], "total": sum(plan["counts"].values()),
            "detached_memberships": plan["detached_memberships"], "retained_staff": plan["retained_staff"], "expires_at": expires}


class CleanupExecute(Reauthenticated):
    token: str = Field(max_length=12000)
    confirmation: str = Field(max_length=100)
    backup_confirmed: bool


@router.post("/cleanup/execute")
def perform_cleanup(body: CleanupExecute, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(body.token, SECRET_KEY, algorithms=[ALGORITHM], audience="database-cleanup")
    except jwt.PyJWTError:
        raise HTTPException(409, "Preview expired or invalid. Generate a new preview.")
    if payload["actor"] != user.id or payload["ver"] != (user.token_version or 0) or payload.get("sid") != user.session_key:
        raise HTTPException(403, "This preview belongs to another administrator session")
    if body.confirmation != payload["phrase"] or not body.backup_confirmed:
        raise HTTPException(422, "Confirm the exact phrase and backup acknowledgement")
    selection = CleanupSelection(**payload["selection"])
    groups = selection_groups(selection, user)
    with operations.lock, task_lock:
        if operations.cleanup_running:
            raise HTTPException(409, "Another cleanup is already running")
        if selection.user_id is None and not operations.maintenance:
            raise HTTPException(409, "Enable maintenance mode before bulk cleanup")
        if operations.active_requests:
            raise HTTPException(409, "Requests are still running. Wait for them to finish and retry.")
        operations.cleanup_running = True
        try:
            lock_database(db)
            reauthenticate(db, user, body.password)
            if db.scalar(select(DevTask.id).where(DevTask.status == "running").limit(1)):
                raise HTTPException(409, "Wait for running maintenance tasks to finish")
            if db.scalar(select(AuditLog.id).where(AuditLog.action == "cleanup.executed", AuditLog.target == payload["nonce"])):
                raise HTTPException(409, "This cleanup has already been executed")
            plan = build_plan(db, groups, user, selection.user_id, selection.company_id, selection.job_id)
            if plan["digest"] != payload["digest"]:
                raise HTTPException(409, "Affected records changed. Generate and review a new preview.")
            execute_plan(db, plan)
            record(db, user, "cleanup.executed", payload["nonce"], {"selection": selection.model_dump(), "counts": plan["counts"], "reason": body.reason})
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            operations.cleanup_running = False
    return {"deleted": plan["counts"], "total": sum(plan["counts"].values()), "maintenance": operations.maintenance}
