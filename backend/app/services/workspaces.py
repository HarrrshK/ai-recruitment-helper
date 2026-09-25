from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Company, Job, User


def migrate_shared_workspace(db: Session):
    """Keep pre-company accounts/jobs together in their original shared workspace."""
    users = list(db.scalars(select(User).where(User.role == "recruiter", User.company_id.is_(None))))
    jobs = list(db.scalars(select(Job).where(Job.company_id.is_(None))))
    if not users and not jobs:
        return
    company = db.scalar(select(Company).where(Company.legacy_workspace.is_(True)))
    if not company:
        company = Company(name="Existing workspace", legacy_workspace=True)
        db.add(company)
        db.flush()
    for row in [*users, *jobs]:
        row.company_id = company.id
    db.commit()


def company_for(db: Session, user: User) -> Company:
    company = db.get(Company, user.company_id) if user.company_id else None
    if not company:
        raise HTTPException(409, "Your account needs a company workspace. Sign in again after the server restarts.")
    return company


def company_job(db: Session, job_id: int, user: User) -> Job:
    job = db.get(Job, job_id)
    if not job or not user.company_id or job.company_id != user.company_id:
        raise HTTPException(404, "Job not found")
    return job
