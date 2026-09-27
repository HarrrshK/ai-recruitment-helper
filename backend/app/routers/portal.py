from datetime import UTC, datetime
from pathlib import PurePath
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_candidate, require_recruiter
from app.agents.jd_generator import JobRequirements, extract_requirements
from app.agents.matcher import WEIGHTS, match_candidate
from app.agents.resume_parser import parse_resume
from app.db import get_db
from app.llm.client import LLMClient, get_llm
from app.models import Application, ApplicationMessage, Candidate, CandidateProfile, Company, HiringInterview, Job, Match, Resume, User
from app.services.embeddings import Embedder, get_embedder
from app.services.resume_text import MAX_BYTES, ResumeFileError, extract_resume_text
from app.services.workspaces import owned_jobs
from app.services.permissions import check_permission

router = APIRouter(prefix="/api/portal", tags=["candidate portal"])


def owned_application(db: Session, application_id: int, user: User) -> Application:
    application = db.get(Application, application_id)
    if not application or (user.role != "recruiter" and application.user_id != user.id):
        raise HTTPException(404, "Application not found")
    if user.role == "recruiter":
        from app.services.workspaces import company_for
        company_for(db, user)
        job = db.get(Job, application.job_id)
        if not job or not user.company_id or job.company_id != user.company_id or job.creator_id != user.id:
            raise HTTPException(404, "Application not found")
    return application


def application_out(db: Session, application: Application) -> dict:
    resume = db.get(Resume, application.resume_id)
    owner = db.get(User, application.user_id)
    job = db.get(Job, application.job_id)
    company = db.get(Company, job.company_id) if job and job.company_id else None
    return {"id": application.id, "job_id": application.job_id, "job_title": application.job_title,
            "candidate_public_id": owner.public_id,
            "candidate_name": owner.full_name, "status": application.status,
            "resume_name": resume.filename, "resume_id": resume.id,
            "cover_letter": application.cover_letter, "history": application.history,
            "assessment": application.assessment, "created_at": application.created_at,
            "updated_at": application.updated_at, "company_name": company.name if company else "",
            "assessment_stale": bool(application.assessment and application.assessment.get("job_revision", 1) != (job.revision or 1)) if job else False}


def change_status(application: Application, status: str, note: str):
    application.status = status
    application.updated_at = datetime.now(UTC)
    application.history = [*(application.history or []), {"status": status, "note": note, "at": application.updated_at.isoformat()}]


def public_job(job: Job, db: Session) -> dict:
    description = job.description or {}
    company = db.get(Company, job.company_id) if job.company_id else None
    return {"id": job.id, "title": job.title, "brief": job.brief, "status": job.status,
            "markdown": description.get("markdown"), "requirements": description.get("requirements"),
            "created_at": job.created_at, "company_name": company.name if company else "",
            "company_about": company.about if company else "", "location": job.location or "",
            "work_mode": job.work_mode or "onsite", "employment_type": job.employment_type or "full_time"}


@router.get("/jobs")
def jobs(q: str = "", db: Session = Depends(get_db)):
    query = select(Job).join(Company, Job.company_id == Company.id).join(User, Job.creator_id == User.id).where(Job.status == "ready", Company.active.is_not(False), User.disabled.is_not(True)).order_by(Job.id.desc())
    return [public_job(job, db) for job in db.scalars(query) if q.lower() in f"{job.title} {job.brief} {job.description}".lower()]


@router.get("/jobs/{job_id}")
def job_details(job_id: int, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job or job.status != "ready" or not job.creator_id or not job.company_id:
        raise HTTPException(404, "This job is not open for applications")
    company, creator = db.get(Company, job.company_id), db.get(User, job.creator_id)
    if not company or company.active is False or not creator or creator.disabled:
        raise HTTPException(404, "This job is not open for applications")
    return public_job(job, db)


class ProfileIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    headline: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=60)
    location: str = Field(default="", max_length=200)
    current_position: str = Field(default="", max_length=200)
    bio: str = Field(default="", max_length=3000)
    skills: list[str] = Field(default_factory=list, max_length=40)
    visible_fields: list[Literal["headline", "phone", "location", "current_position", "bio", "skills", "email"]] = Field(default_factory=list)


@router.get("/profile")
def profile(user: User = Depends(require_candidate), db: Session = Depends(get_db)):
    saved = db.get(CandidateProfile, user.id)
    result = {"full_name": user.full_name, "email": user.email}
    result["public_id"] = user.public_id
    result["visible_fields"] = saved.visible_fields if saved and saved.visible_fields is not None else ["headline", "location", "current_position", "bio", "skills"]
    for field in ("headline", "phone", "location", "current_position", "bio", "skills"):
        result[field] = getattr(saved, field) if saved else ([] if field == "skills" else "")
    return result


@router.put("/profile")
def save_profile(body: ProfileIn, user: User = Depends(require_candidate), db: Session = Depends(get_db)):
    if not body.full_name.strip():
        raise HTTPException(422, "Full name is required")
    account = db.get(User, user.id)
    account.full_name = body.full_name.strip()
    candidate = db.get(Candidate, user.candidate_id)
    if candidate:
        candidate.name = account.full_name
    saved = db.get(CandidateProfile, user.id)
    if not saved:
        saved = CandidateProfile(user_id=user.id)
        db.add(saved)
    for key, value in body.model_dump(exclude={"full_name"}).items():
        setattr(saved, key, value)
    db.commit()
    user.full_name = account.full_name
    return profile(user, db)


def resume_out(resume: Resume):
    return {"id": resume.id, "filename": resume.filename, "size": len(resume.content), "created_at": resume.created_at}


@router.get("/resumes")
def resumes(user: User = Depends(require_candidate), db: Session = Depends(get_db)):
    return [resume_out(r) for r in db.scalars(select(Resume).where(Resume.user_id == user.id, Resume.archived.is_(False)).order_by(Resume.id.desc()))]


@router.post("/resumes", status_code=201)
def upload_resume(file: UploadFile, user: User = Depends(require_candidate), db: Session = Depends(get_db)):
    content = file.file.read(MAX_BYTES + 1)
    filename = PurePath((file.filename or "resume.txt").replace("\\", "/")).name[:255]
    try:
        text = extract_resume_text(filename, content)
    except ResumeFileError as exc:
        raise HTTPException(422, str(exc)) from exc
    resume = Resume(user_id=user.id, filename=filename, content=content, text=text)
    db.add(resume)
    db.commit()
    return resume_out(resume)


@router.get("/resumes/{resume_id}/download")
def download_resume(resume_id: int, user: User = Depends(require_candidate), db: Session = Depends(get_db)):
    resume = db.get(Resume, resume_id)
    if not resume or resume.user_id != user.id:
        raise HTTPException(404, "Resume not found")
    return Response(resume.content, media_type="application/octet-stream", headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(resume.filename)}"})


@router.delete("/resumes/{resume_id}", status_code=204)
def remove_resume(resume_id: int, user: User = Depends(require_candidate), db: Session = Depends(get_db)):
    resume = db.get(Resume, resume_id)
    if not resume or resume.user_id != user.id:
        raise HTTPException(404, "Resume not found")
    # Keep the exact document attached to submitted applications.
    resume.archived = True
    db.commit()


class ApplyIn(BaseModel):
    job_id: int
    resume_id: int
    cover_letter: str = Field(default="", max_length=5000)


@router.post("/applications", status_code=201)
def apply(body: ApplyIn, user: User = Depends(require_candidate), db: Session = Depends(get_db)):
    job = db.get(Job, body.job_id)
    if not job or job.status != "ready" or not job.creator_id or not job.company_id:
        raise HTTPException(409, "This job is no longer accepting applications")
    company, creator = db.get(Company, job.company_id), db.get(User, job.creator_id)
    if not company or company.active is False or not creator or creator.disabled:
        raise HTTPException(409, "This job is no longer accepting applications")
    resume = db.get(Resume, body.resume_id)
    if not resume or resume.user_id != user.id or resume.archived:
        raise HTTPException(422, "Choose one of your available resumes")
    if not user.candidate_id:
        raise HTTPException(409, "Sign in again as a candidate to complete your profile")
    application = Application(user_id=user.id, candidate_id=user.candidate_id, job_id=job.id,
                              job_title=job.title, resume_id=resume.id, cover_letter=body.cover_letter)
    change_status(application, "applied", "Application received")
    db.add(application)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "You have already applied to this job") from exc
    return application_out(db, application)


@router.get("/applications")
def applications(user: User = Depends(require_candidate), db: Session = Depends(get_db)):
    return [application_out(db, a) for a in db.scalars(select(Application).where(Application.user_id == user.id).order_by(Application.id.desc()))]


@router.get("/applications/{application_id}/cohort")
def application_cohort(application_id: int, user: User = Depends(require_candidate), db: Session = Depends(get_db)):
    """Return only the signed-in candidate's rank and anonymous cohort size."""
    application = owned_application(db, application_id, user)
    assessment = application.assessment or {}
    job = db.get(Job, application.job_id)
    if not job or assessment.get("overall_score") is None or assessment.get("job_revision", 1) != (job.revision or 1):
        return {"rank": None, "assessed_count": 0, "note": "A current assessment is needed before ranking is available."}
    rows = db.scalars(select(Application).where(Application.job_id == job.id, Application.status.not_in(("withdrawn", "rejected"))))
    scores = [float((row.assessment or {}).get("overall_score")) for row in rows
              if row.assessment and row.assessment.get("overall_score") is not None
              and row.assessment.get("job_revision", 1) == (job.revision or 1)]
    own_score = float(assessment["overall_score"])
    ahead = sum(score > own_score for score in scores)
    return {"rank": ahead + 1, "assessed_count": len(scores),
            "top_percent": round((ahead + 1) / len(scores) * 100) if scores else None,
            "note": "Other applicants’ names, profiles, and scores are never shown."}


@router.post("/resume-screen")
def screen_resume(resume_id: int, user: User = Depends(require_candidate), db: Session = Depends(get_db), llm: LLMClient = Depends(get_llm)):
    resume = db.get(Resume, resume_id)
    if not resume or resume.user_id != user.id or resume.archived:
        raise HTTPException(404, "Resume not found")
    profile = parse_resume(resume.text, llm)
    skills = {skill.casefold() for skill in profile.skills}
    results = []
    public_jobs = jobs(db=db)
    for item in public_jobs:
        requirements = item.get("requirements") or {}
        must = list(requirements.get("must_have_skills") or [])
        nice = list(requirements.get("nice_to_have_skills") or [])
        if not must and not nice:
            continue
        norm = lambda value: str(value).strip().casefold()
        matched_must = [skill for skill in must if norm(skill) in skills]
        missing_must = [skill for skill in must if norm(skill) not in skills]
        matched_nice = [skill for skill in nice if norm(skill) in skills]
        score = round((len(matched_must) * 2 + len(matched_nice)) / max(1, len(must) * 2 + len(nice)) * 100)
        results.append({"job": item, "fit_score": score, "matched_must": matched_must,
                        "missing_must": missing_must, "matched_nice": matched_nice,
                        "min_years": int(requirements.get("min_years_experience") or 0),
                        "candidate_years": round(profile.total_years_experience, 1)})
    return sorted(results, key=lambda row: row["fit_score"], reverse=True)


@router.get("/applications/{application_id}")
def application_detail(application_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return application_out(db, owned_application(db, application_id, user))


@router.post("/applications/{application_id}/withdraw")
def withdraw(application_id: int, user: User = Depends(require_candidate), db: Session = Depends(get_db)):
    application = owned_application(db, application_id, user)
    if application.status in ("rejected", "hired", "withdrawn"):
        raise HTTPException(409, "This application is already closed")
    change_status(application, "withdrawn", "Withdrawn by candidate")
    db.commit()
    return application_out(db, application)


@router.post("/applications/{application_id}/evaluate")
def evaluate(application_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db),
             llm: LLMClient = Depends(get_llm), embedder: Embedder = Depends(get_embedder), force: bool = False):
    application = owned_application(db, application_id, user)
    if user.role == "recruiter":
        check_permission(user, "applicants.review")
    if force and user.role != "recruiter":
        raise HTTPException(403, "Only the hiring team can reassess an application")
    if application.assessment and not force:
        return application_out(db, application)
    if application.status in ("withdrawn", "rejected", "hired"):
        raise HTTPException(409, "This application is closed")
    job = db.get(Job, application.job_id)
    if not job:
        raise HTTPException(409, "The job is no longer available for assessment")
    resume = db.get(Resume, application.resume_id)
    revision = job.revision or 1
    profile = parse_resume(resume.text, llm)
    description = job.description or {}
    requirements = JobRequirements(**description["requirements"]) if description.get("requirements") else extract_requirements(description.get("markdown") or job.brief, llm)
    result = match_candidate(job_title=job.title, requirements=requirements, profile=profile,
                             resume_text=resume.text, llm=llm, embedder=embedder, custom_weights=job.matching_rules)
    available = {key: value for key, value in result.breakdown.items() if value is not None}
    weights = {key: (job.matching_rules or {}).get(key, WEIGHTS[key]) for key in available}
    total = sum(weights.values()) or 1
    weights = {key: value / total for key, value in weights.items()}
    # Save the scoring inputs alongside the result; later resume/job edits cannot rewrite the explanation.
    assessment = {"overall_score": result.overall_score, "breakdown": result.breakdown,
                  "weights": weights, "summary": result.summary, "strengths": result.strengths,
                  "gaps": result.gaps, "evidence": [e.model_dump() for e in result.evidence],
                  "skill_details": [{"skill": s.skill, "kind": s.kind, "status": s.status} for s in result.skill_details],
                  "years_experience": profile.total_years_experience,
                  "minimum_years": requirements.min_years_experience,
                  "review_scores": result.review_scores, "evaluated_at": datetime.now(UTC).isoformat(), "job_revision": revision}
    db.refresh(application)
    if application.status in ("withdrawn", "rejected", "hired"):
        raise HTTPException(409, "This application was closed during evaluation")
    db.refresh(job)
    if (job.revision or 1) != revision:
        raise HTTPException(409, "The job requirements changed during assessment. Please try again.")
    if application.assessment and not force:
        return application_out(db, application)
    application.assessment = assessment
    if application.status == "applied":
        change_status(application, "screened", "Resume match assessment completed")
    candidate = db.get(Candidate, application.candidate_id)
    candidate.resume_text = resume.text
    candidate.parsed_profile = profile.model_dump()
    match = db.scalar(select(Match).where(Match.job_id == job.id, Match.candidate_id == candidate.id))
    if not match:
        match = Match(job_id=job.id, candidate_id=candidate.id)
        db.add(match)
    for key in ("overall_score", "breakdown", "summary", "strengths", "gaps", "evidence", "skill_details"):
        setattr(match, key, assessment[key])
    match.confidence = result.confidence
    match.dropped_quotes = result.dropped_quotes
    db.commit()
    return application_out(db, application)


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


@router.get("/message-notifications")
def message_notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = select(ApplicationMessage).join(Application, Application.id == ApplicationMessage.application_id).join(Job, Job.id == Application.job_id)
    if user.role == "candidate":
        query = query.where(Application.user_id == user.id, ApplicationMessage.sender_role == "recruiter")
    elif user.role == "recruiter":
        from app.services.workspaces import company_for
        company_for(db, user)
        query = query.where(*owned_jobs(user), ApplicationMessage.sender_role == "candidate")
    else:
        raise HTTPException(403, "Candidate or recruiter workspace required")
    query = query.where(ApplicationMessage.read_at.is_(None))
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.execute(query.with_only_columns(ApplicationMessage.id, ApplicationMessage.application_id, ApplicationMessage.sender_name, Application.job_title).order_by(ApplicationMessage.id.desc()).limit(20)).all()
    return {"unread_count": total, "messages": [dict(row._mapping) for row in rows]}


class MessagesReadIn(BaseModel):
    through_id: int = Field(ge=1)


@router.post("/applications/{application_id}/messages/read", status_code=204)
def read_messages(application_id: int, body: MessagesReadIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    owned_application(db, application_id, user)
    if user.role not in ("candidate", "recruiter"):
        raise HTTPException(403, "Candidate or recruiter workspace required")
    # Acknowledge only messages actually fetched, not arrivals racing with the request.
    db.execute(update(ApplicationMessage).where(ApplicationMessage.application_id == application_id,
        ApplicationMessage.id <= body.through_id, ApplicationMessage.sender_role != user.role,
        ApplicationMessage.read_at.is_(None)).values(read_at=datetime.now(UTC)))
    db.commit()


@router.get("/applications/{application_id}/messages")
def messages(application_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    owned_application(db, application_id, user)
    return [{"id": m.id, "sender_role": m.sender_role, "sender_name": m.sender_name, "body": m.body, "created_at": m.created_at}
            for m in db.scalars(select(ApplicationMessage).where(ApplicationMessage.application_id == application_id).order_by(ApplicationMessage.id))]


@router.post("/applications/{application_id}/messages", status_code=201)
def send_message(application_id: int, body: MessageIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    owned_application(db, application_id, user)
    if user.role == "recruiter":
        check_permission(user, "messages.send")
    if not body.body.strip():
        raise HTTPException(422, "Message cannot be empty")
    message = ApplicationMessage(application_id=application_id, sender_id=user.id, sender_role=user.role,
                                 sender_name=user.full_name or user.email, body=body.body.strip())
    db.add(message)
    db.commit()
    return {"id": message.id}


@router.get("/hr/applications")
def hr_applications(user: User = Depends(require_recruiter), db: Session = Depends(get_db)):
    return [application_out(db, a) for a in db.scalars(select(Application).join(Job, Application.job_id == Job.id).where(*owned_jobs(user)).order_by(Application.updated_at.desc()))]


class StatusIn(BaseModel):
    status: Literal["applied", "screened", "shortlisted", "interview", "offer", "hired", "rejected"]
    note: str = Field(min_length=1, max_length=1000)


@router.patch("/hr/applications/{application_id}/status")
def update_status(application_id: int, body: StatusIn, user: User = Depends(require_recruiter), db: Session = Depends(get_db)):
    application = owned_application(db, application_id, user)
    check_permission(user, "applicants.review")
    if application.status == "withdrawn":
        raise HTTPException(409, "The candidate withdrew this application")
    if not body.note.strip():
        raise HTTPException(422, "A status note is required")
    change_status(application, body.status, body.note.strip())
    db.commit()
    return application_out(db, application)


@router.get("/applications/{application_id}/interviews")
def candidate_interviews(application_id: int, user: User = Depends(require_candidate), db: Session = Depends(get_db)):
    owned_application(db, application_id, user)
    return [{"id": i.id, "title": i.title, "status": i.status, "scheduled_at": i.scheduled_at,
             "location": i.location, "candidate_feedback": i.candidate_feedback}
            for i in db.scalars(select(HiringInterview).where(HiringInterview.application_id == application_id).order_by(HiringInterview.id.desc()))]
