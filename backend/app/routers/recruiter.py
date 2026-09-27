from datetime import UTC, datetime
from typing import Literal
from urllib.parse import quote, urlparse

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.interviewer import generate_questions
from app.agents.jd_generator import JobRequirements, extract_requirements, stream_jd
from app.agents.resume_parser import parse_resume
from app.auth import require_recruiter
from app.db import get_db
from app.llm.client import LLMClient, get_llm
from app.models import Application, CandidateProfile, HiringInterview, Job, Resume, User
from app.routers.portal import application_out, change_status, owned_application
from app.services.anonymizer import anonymize_resume
from app.services.workspaces import company_for, company_job, consume_invite, owned_jobs, invite_permissions
from app.services.permissions import check_permission
from app.services.audit import record

router = APIRouter(prefix="/api/recruiter", tags=["recruiter"], dependencies=[Depends(require_recruiter)])


class CompanyIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    industry: str = Field(default="", max_length=200)
    website: str = Field(default="", max_length=500)
    location: str = Field(default="", max_length=200)
    size: Literal["", "1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"] = ""
    about: str = Field(default="", max_length=5000)
    contact_email: str = Field(default="", max_length=200)

    @field_validator("name")
    @classmethod
    def valid_name(cls, value):
        if not value.strip():
            raise ValueError("Company name is required")
        return value.strip()

    @field_validator("website")
    @classmethod
    def valid_website(cls, value):
        if value and (urlparse(value).scheme not in ("https", "http") or not urlparse(value).netloc):
            raise ValueError("Use a complete https:// or http:// website address")
        return value


def company_out(company):
    return {"id": company.id, **{key: getattr(company, key) for key in CompanyIn.model_fields}}


@router.get("/company")
def get_company(user: User = Depends(require_recruiter), db: Session = Depends(get_db)):
    return company_out(company_for(db, user)) if user.company_id else None


@router.put("/company")
def save_company(body: CompanyIn, user: User = Depends(require_recruiter), db: Session = Depends(get_db)):
    check_permission(user, "company.edit")
    company = company_for(db, user)
    for key, value in body.model_dump().items():
        setattr(company, key, value)
    record(db, user, "company.member_edit", company.id)
    db.commit()
    return company_out(company)


class InviteIn(BaseModel):
    code: str = Field(min_length=1, max_length=200)


@router.post("/company/join")
def join_company(body: InviteIn, user: User = Depends(require_recruiter), db: Session = Depends(get_db)):
    account = db.get(User, user.id)
    account.company_id = consume_invite(db, body.code, account.email, account.company_id)
    account.permissions = invite_permissions(db, body.code)
    db.commit()
    return company_out(company_for(db, account))


class JobIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    brief: str = Field(default="", max_length=3000)
    markdown: str = Field(default="", max_length=30000)
    location: str = Field(default="", max_length=200)
    work_mode: Literal["onsite", "hybrid", "remote"] = "onsite"
    employment_type: Literal["full_time", "part_time", "contract", "internship"] = "full_time"
    requirements: JobRequirements
    status: Literal["draft", "ready", "closed"] = "draft"

    @field_validator("title")
    @classmethod
    def title_required(cls, value):
        if len(value.strip()) < 2:
            raise ValueError("Job title must contain at least two characters")
        return value.strip()

    @field_validator("requirements")
    @classmethod
    def valid_requirements(cls, value):
        if not 0 <= value.min_years_experience <= 60:
            raise ValueError("Minimum experience must be between 0 and 60 years")
        for skills in (value.must_have_skills, value.nice_to_have_skills):
            if len(skills) > 50 or any(not s.strip() or len(s) > 120 for s in skills):
                raise ValueError("Use up to 50 skills, each between 1 and 120 characters")
        if len(value.responsibilities) > 50 or any(len(s) > 2000 for s in value.responsibilities):
            raise ValueError("Use up to 50 responsibilities, each at most 2000 characters")
        return value


def job_out(db: Session, job: Job):
    description = job.description or {}
    applications = list(db.scalars(select(Application).where(Application.job_id == job.id)))
    return {"id": job.id, "title": job.title, "brief": job.brief, "status": job.status,
            "markdown": description.get("markdown", ""), "requirements": description.get("requirements"),
            "location": job.location or "", "work_mode": job.work_mode or "onsite",
            "employment_type": job.employment_type or "full_time", "revision": job.revision or 1,
            "created_at": job.created_at, "applicants": len(applications),
            "shortlisted": sum(a.status == "shortlisted" for a in applications)}


def write_job(db: Session, job: Job, body: JobIn, user: User):
    check_permission(user, "jobs.edit" if job.id else "jobs.create")
    company = company_for(db, user)
    if body.status == "ready" and (not body.markdown.strip() or not company.name.strip()):
        raise HTTPException(422, "Add a company name and job description before publishing")
    description = {"markdown": body.markdown, "requirements": body.requirements.model_dump()}
    if job.id and (job.title != body.title or job.description != description):
        job.revision = (job.revision or 1) + 1
    for key, value in body.model_dump(exclude={"markdown", "requirements"}).items():
        setattr(job, key, value)
    job.company_id = company.id
    if job.id is None:
        job.creator_id = user.id
    job.description = description
    db.add(job)
    db.commit()
    return job_out(db, job)


@router.get("/jobs")
def jobs(user: User = Depends(require_recruiter), db: Session = Depends(get_db)):
    company_for(db, user)
    return [job_out(db, job) for job in db.scalars(select(Job).where(*owned_jobs(user)).order_by(Job.id.desc()))]


@router.post("/jobs", status_code=201)
def create_job(body: JobIn, user: User = Depends(require_recruiter), db: Session = Depends(get_db)):
    return write_job(db, Job(), body, user)


@router.get("/jobs/{job_id}")
def get_job(job_id: int, user: User = Depends(require_recruiter), db: Session = Depends(get_db)):
    return job_out(db, company_job(db, job_id, user))


@router.put("/jobs/{job_id}")
def edit_job(job_id: int, body: JobIn, user: User = Depends(require_recruiter), db: Session = Depends(get_db)):
    return write_job(db, company_job(db, job_id, user), body, user)


@router.post("/jobs/{job_id}/close")
def close_job(job_id: int, user: User = Depends(require_recruiter), db: Session = Depends(get_db)):
    job = company_job(db, job_id, user)
    check_permission(user, "jobs.edit")
    job.status = "closed"
    db.commit()
    return job_out(db, job)


def applicant_rows(db: Session, user: User, job_id: int | None = None):
    query = select(Application).join(Job, Application.job_id == Job.id).where(*owned_jobs(user))
    if job_id is not None:
        company_job(db, job_id, user)
        query = query.where(Application.job_id == job_id)
    rows = [application_out(db, a) for a in db.scalars(query.order_by(Application.id.desc()))]
    scores_by_job = {}
    for row in rows:
        score = (row["assessment"] or {}).get("overall_score")
        if score is not None and not row["assessment_stale"] and row["status"] not in ("withdrawn", "rejected"):
            scores_by_job.setdefault(row["job_id"], []).append(score)
    ranks = {}
    for job_id, scores in scores_by_job.items():
        for index, score in enumerate(sorted(scores, reverse=True), start=1):
            ranks.setdefault((job_id, score), index)
    for row in rows:
        row["rank"] = None if row["assessment_stale"] or row["status"] in ("withdrawn", "rejected") else ranks.get((row["job_id"], (row["assessment"] or {}).get("overall_score")))
    return sorted(rows, key=lambda r: (r["rank"] is None, r["rank"] or 0, -r["id"]))


@router.get("/applicants")
def applicants(job_id: int | None = None, user: User = Depends(require_recruiter), db: Session = Depends(get_db)):
    company_for(db, user)
    return applicant_rows(db, user, job_id)


@router.get("/applicants/{application_id}")
def applicant(application_id: int, user: User = Depends(require_recruiter), db: Session = Depends(get_db)):
    application = owned_application(db, application_id, user)
    account = db.get(User, application.user_id)
    profile = db.get(CandidateProfile, account.id)
    resume = db.get(Resume, application.resume_id)
    visible = set(profile.visible_fields if profile and profile.visible_fields is not None else ["headline", "location", "current_position", "bio", "skills"])
    return {**application_out(db, application), "email": account.email if "email" in visible else "", "resume_text": resume.text,
            "profile": {key: (getattr(profile, key) if profile else ([] if key == "skills" else "")) if key in visible else ([] if key == "skills" else "") for key in ("headline", "phone", "location", "current_position", "bio", "skills")},
            "candidate_public_id": account.public_id, "visible_fields": sorted(visible)}


class GenerateJobIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    brief: str = Field(default="", max_length=3000)


@router.post("/jobs/generate")
def generate_job(body: GenerateJobIn, user: User = Depends(require_recruiter), llm: LLMClient = Depends(get_llm)):
    if "jobs.create" not in (user.permissions or []) and "jobs.edit" not in (user.permissions or []):
        check_permission(user, "jobs.create")
    markdown = "".join(stream_jd(body.title, body.brief, llm)).strip()
    if not markdown:
        raise HTTPException(502, "The job description generator returned no content")
    requirements = extract_requirements(markdown, llm)
    return {"markdown": markdown, "requirements": requirements.model_dump()}


@router.get("/applicants/{application_id}/resume")
def resume_download(application_id: int, user: User = Depends(require_recruiter), db: Session = Depends(get_db)):
    application = owned_application(db, application_id, user)
    resume = db.get(Resume, application.resume_id)
    return Response(resume.content, media_type="application/octet-stream", headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(resume.filename)}"})


class InterviewIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    interviewer: str = Field(default="", max_length=200)
    scheduled_at: datetime | None = None
    location: str = Field(default="", max_length=500)
    status: Literal["planned", "scheduled", "in_progress", "completed", "cancelled"] = "planned"


class FeedbackIn(BaseModel):
    technical: float = Field(ge=0, le=10)
    problem_solving: float = Field(ge=0, le=10)
    communication: float = Field(ge=0, le=10)
    role_fit: float = Field(ge=0, le=10)
    recommendation: Literal["hire", "hold", "reject"]
    notes: str = Field(min_length=1, max_length=6000)
    candidate_feedback: str = Field(default="", max_length=3000)


def interview_out(db: Session, interview: HiringInterview):
    application = db.get(Application, interview.application_id)
    owner = db.get(User, application.user_id)
    return {"id": interview.id, "application_id": application.id, "job_id": application.job_id,
            "job_title": application.job_title, "candidate_name": owner.full_name,
            **{key: getattr(interview, key) for key in ("title", "interviewer", "scheduled_at", "location", "status", "questions", "feedback", "candidate_feedback", "created_at", "updated_at")}}


def owned_interview(db: Session, interview_id: int, user: User):
    interview = db.get(HiringInterview, interview_id)
    if not interview:
        raise HTTPException(404, "Interview not found")
    owned_application(db, interview.application_id, user)
    return interview


def write_interview(db: Session, interview: HiringInterview, body: InterviewIn, user: User):
    check_permission(user, "interviews.manage")
    application = owned_application(db, interview.application_id, user)
    if application.status in ("withdrawn", "rejected", "hired"):
        raise HTTPException(409, "This application is closed")
    if not body.title.strip():
        raise HTTPException(422, "Interview title is required")
    if body.status == "scheduled" and not body.scheduled_at:
        raise HTTPException(422, "A scheduled interview needs a date and time")
    if body.scheduled_at and body.scheduled_at.tzinfo is None:
        raise HTTPException(422, "Include a timezone with the interview time")
    changed = not interview.id or any(getattr(interview, key) != value for key, value in body.model_dump().items())
    for key, value in body.model_dump().items():
        setattr(interview, key, value)
    interview.updated_at = datetime.now(UTC)
    if changed and body.status in ("scheduled", "in_progress", "completed", "cancelled"):
        note = f"{body.title}: {body.status.replace('_', ' ')}"
        if body.scheduled_at and body.status == "scheduled":
            note += f" for {body.scheduled_at.astimezone(UTC).isoformat()}"
        change_status(application, "interview" if body.status != "cancelled" else application.status, note)
    db.add(interview)
    db.commit()
    return interview_out(db, interview)


@router.get("/interviews")
def interviews(application_id: int | None = None, user: User = Depends(require_recruiter), db: Session = Depends(get_db)):
    company_for(db, user)
    query = select(HiringInterview).join(Application, HiringInterview.application_id == Application.id).join(Job, Application.job_id == Job.id).where(*owned_jobs(user))
    if application_id is not None:
        owned_application(db, application_id, user)
        query = query.where(HiringInterview.application_id == application_id)
    return [interview_out(db, i) for i in db.scalars(query.order_by(HiringInterview.id.desc()))]


@router.post("/applicants/{application_id}/interviews", status_code=201)
def create_interview(application_id: int, body: InterviewIn, user: User = Depends(require_recruiter), db: Session = Depends(get_db)):
    return write_interview(db, HiringInterview(application_id=application_id), body, user)


@router.get("/interviews/{interview_id}")
def get_interview(interview_id: int, user: User = Depends(require_recruiter), db: Session = Depends(get_db)):
    return interview_out(db, owned_interview(db, interview_id, user))


@router.put("/interviews/{interview_id}")
def edit_interview(interview_id: int, body: InterviewIn, user: User = Depends(require_recruiter), db: Session = Depends(get_db)):
    return write_interview(db, owned_interview(db, interview_id, user), body, user)


@router.put("/interviews/{interview_id}/feedback")
def feedback(interview_id: int, body: FeedbackIn, user: User = Depends(require_recruiter), db: Session = Depends(get_db)):
    interview = owned_interview(db, interview_id, user)
    check_permission(user, "interviews.manage")
    if interview.status == "cancelled":
        raise HTTPException(409, "Cannot record feedback for a cancelled interview")
    if not body.notes.strip():
        raise HTTPException(422, "Interview feedback is required")
    interview.feedback = {**body.model_dump(exclude={"candidate_feedback"}), "author": user.full_name, "recorded_at": datetime.now(UTC).isoformat()}
    interview.candidate_feedback = body.candidate_feedback.strip()
    interview.updated_at = datetime.now(UTC)
    db.commit()
    return interview_out(db, interview)


@router.post("/interviews/{interview_id}/questions")
def questions(interview_id: int, user: User = Depends(require_recruiter), db: Session = Depends(get_db), llm: LLMClient = Depends(get_llm)):
    interview = owned_interview(db, interview_id, user)
    check_permission(user, "interviews.manage")
    if interview.questions:
        return interview_out(db, interview)
    if interview.status in ("completed", "cancelled"):
        raise HTTPException(409, "This interview is closed")
    application = owned_application(db, interview.application_id, user)
    if application.status in ("withdrawn", "rejected", "hired"):
        raise HTTPException(409, "This application is closed")
    resume = db.get(Resume, application.resume_id)
    job = company_job(db, application.job_id, user)
    requirements = (job.description or {}).get("requirements")
    if not requirements:
        raise HTTPException(409, "Add structured job requirements before generating questions")
    profile = parse_resume(resume.text, llm)
    generated = generate_questions(job_title=job.title, requirements=JobRequirements(**requirements),
        years=profile.total_years_experience, resume_text=anonymize_resume(resume.text, profile),
        areas_to_probe=(application.assessment or {}).get("gaps", []), llm=llm, custom_questions=job.custom_questions)
    db.refresh(interview)
    db.refresh(application)
    if interview.status in ("completed", "cancelled") or application.status in ("withdrawn", "rejected", "hired"):
        raise HTTPException(409, "The interview or application was closed during generation")
    if not interview.questions:
        interview.questions = [q.model_dump() for q in generated]
        interview.updated_at = datetime.now(UTC)
        db.commit()
    return interview_out(db, interview)


@router.get("/dashboard")
def dashboard(user: User = Depends(require_recruiter), db: Session = Depends(get_db)):
    company = company_for(db, user)
    job_rows = list(db.scalars(select(Job).where(*owned_jobs(user))))
    applications = applicant_rows(db, user)
    interview_rows = interviews(None, user, db)
    return {"company": company_out(company), "open_jobs": sum(j.status == "ready" for j in job_rows),
            "draft_jobs": sum(j.status == "draft" for j in job_rows), "applications": len(applications),
            "shortlisted": sum(a["status"] == "shortlisted" for a in applications),
            "pending_review": sum(not a["assessment"] or a["assessment_stale"] for a in applications if a["status"] not in ("withdrawn", "rejected", "hired")),
            "stages": {stage: sum(a["status"] == stage for a in applications) for stage in ("applied", "screened", "shortlisted", "interview", "offer", "hired", "rejected", "withdrawn")},
            "recent_applicants": sorted(applications, key=lambda a: a["id"], reverse=True)[:5],
            "upcoming_interviews": sorted([i for i in interview_rows if i["status"] in ("scheduled", "in_progress")], key=lambda i: str(i["scheduled_at"] or ""))[:5]}
