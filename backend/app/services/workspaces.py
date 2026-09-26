import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import Company, CompanyInvite, Job, User


def company_for(db: Session, user: User) -> Company:
    company = db.get(Company, user.company_id) if user.company_id else None
    if not company:
        raise HTTPException(409, "Accept a company invitation to access your recruiter workspace.")
    if company.active is False:
        raise HTTPException(403, "Company workspace is suspended")
    return company


def owned_jobs(user: User):
    return (Job.creator_id == user.id, Job.company_id == user.company_id, Job.company_id.is_not(None))


def company_job(db: Session, job_id: int, user: User) -> Job:
    company_for(db, user)
    job = db.scalar(select(Job).where(Job.id == job_id, *owned_jobs(user)))
    if not job:
        raise HTTPException(404, "Job not found")
    return job


def issue_invite(db: Session, company_id: int, email: str, days: int = 7, permissions: list | None = None) -> str:
    if not db.get(Company, company_id):
        raise ValueError("Company not found")
    token = secrets.token_urlsafe(32)
    db.add(CompanyInvite(company_id=company_id, email=email.strip().lower(),
        token_hash=hashlib.sha256(token.encode()).hexdigest(), expires_at=datetime.now(UTC) + timedelta(days=days), permissions=permissions))
    db.flush()
    return token


def consume_invite(db: Session, token: str, email: str, current_company: int | None = None) -> int:
    now = datetime.now(UTC)
    invite = db.scalar(select(CompanyInvite).where(CompanyInvite.token_hash == hashlib.sha256(token.encode()).hexdigest(),
        CompanyInvite.email == email.strip().lower(), CompanyInvite.accepted_at.is_(None), CompanyInvite.expires_at > now))
    if not invite or not db.get(Company, invite.company_id) or db.get(Company, invite.company_id).active is False:
        raise HTTPException(422, "Invalid, expired or already used invitation for this email.")
    if current_company and current_company != invite.company_id:
        raise HTTPException(409, "Your account already belongs to another company. Contact your administrator.")
    result = db.execute(update(CompanyInvite).where(CompanyInvite.id == invite.id,
        CompanyInvite.accepted_at.is_(None), CompanyInvite.expires_at > now).values(accepted_at=now).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        raise HTTPException(409, "This invitation has already been accepted.")
    return invite.company_id


def invite_permissions(db, token):
    return db.scalar(select(CompanyInvite.permissions).where(CompanyInvite.token_hash == hashlib.sha256(token.encode()).hexdigest()))
