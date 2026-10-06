import secrets
import time
from datetime import UTC, datetime, timedelta
from typing import Literal
from urllib.parse import quote, urlsplit, urlunsplit

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.auth import ALGORITHM, SECRET_KEY, hash_password, require_superadmin
from app.config import get_settings
from app.db import get_db
from app.models import (Application, AuditLog, Candidate, Company, DevTask, HiringInterview,
                        ImpersonationSession, Job, Resume, RuntimeConfig, User)
from app.routers.dev_admin import CleanupExecute, Reason, reauthenticate
from app.routers.portal import change_status, evaluate_record
from app.routers.recruiter import JobIn
from app.llm.client import get_llm
from app.services.embeddings import get_embedder
from app.services import admin_operations as operations
from app.services.audit import record
from app.services.data_cleanup import execute_plan, lock_database
from app.services.dev_tasks import task_lock
from app.services.platform_operations import (RESOURCES, footprint, get_record, integrity_report,
    labels_for, plan_operation, save_labels, serialize, table_for)

router = APIRouter(prefix="/api/dev/operations", tags=["platform operations"], dependencies=[Depends(require_superadmin)])


@router.post("/records/{resource}/{key}/rerun")
def rerun(resource: Literal["applications", "candidates", "resumes", "matches", "interviews", "jobs"], key: int,
          body: Reason, user=Depends(require_superadmin), db: Session = Depends(get_db),
          llm=Depends(get_llm), embedder=Depends(get_embedder)):
    from app.agents.resume_parser import parse_resume
    from app.agents.interviewer import generate_questions
    from app.agents.jd_generator import JobRequirements
    from app.agents.skill_coach import build_roadmap, find_gaps
    from app.models import Match
    from app.services.anonymizer import anonymize_resume
    from app.services.resume_text import extract_resume_text
    table, original = get_record(db, resource, key)
    snapshot = dict(original)
    original_labels = labels_for(db)
    source_kind = original_labels.get(f"{table.name}:{key}")
    previous_match = None
    if resource == "applications":
        previous_match = db.scalar(select(Match.id).where(Match.candidate_id == snapshot["candidate_id"], Match.job_id == snapshot["job_id"]))
    job_applications = []
    if resource == "jobs":
        job_applications = list(db.scalars(select(Application.id).where(Application.job_id == key,
            Application.status.not_in(["hired", "withdrawn", "rejected"]))))
        if not job_applications or len(job_applications) > 20:
            raise HTTPException(409, "Job rebuild supports 1-20 open applications. For larger jobs, process selected applications individually.")
    with task_lock:
        if db.scalar(select(DevTask.id).where(DevTask.status == "running").limit(1)):
            raise HTTPException(409, "Another AI or maintenance operation is running")
        task = DevTask(kind=f"platform:{resource}")
        db.add(task)
        db.flush()
        task_id = task.id
        if source_kind:
            original_labels[f"dev_tasks:{task_id}"] = source_kind
            save_labels(db, original_labels)
        record(db, user, "platform.rerun.requested", f"{resource}:{key}", {"reason": body.reason, "task_id": task_id, "result": "running"})
        db.commit()
    try:
        if resource == "jobs":
            for application_id in job_applications:
                evaluate_record(db.get(Application, application_id), db, llm, embedder, force=True, commit=False)
        elif resource == "applications":
            evaluate_record(db.get(Application, key), db, llm, embedder, force=True, commit=False)
        else:
            if resource == "candidates":
                generated = parse_resume(snapshot["resume_text"], llm).model_dump()
            elif resource == "resumes":
                generated = extract_resume_text(snapshot["filename"], snapshot["content"])
            elif resource == "matches":
                match = db.get(Match, key)
                gaps = find_gaps(match.skill_details or [])
                if not gaps:
                    raise HTTPException(409, "No skill gaps are available for a roadmap")
                generated = build_roadmap(job_title=match.job.title, years=(match.candidate.parsed_profile or {}).get("total_years_experience", 0), gaps=gaps, llm=llm).model_dump()
            else:
                app = db.get(Application, snapshot["application_id"])
                job, resume = db.get(Job, app.job_id), db.get(Resume, app.resume_id)
                input_revision, input_text = job.revision, resume.text
                if snapshot["status"] in ("completed", "cancelled") or app.status in ("hired", "rejected", "withdrawn"):
                    raise HTTPException(409, "Reset closed application/interview before generating questions")
                profile = parse_resume(resume.text, llm)
                generated = [q.model_dump() for q in generate_questions(job_title=job.title, requirements=JobRequirements(**(job.description or {}).get("requirements", {})), years=profile.total_years_experience,
                    resume_text=anonymize_resume(resume.text, profile), areas_to_probe=(app.assessment or {}).get("gaps", []), llm=llm, custom_questions=job.custom_questions)]
            db.expire_all()
            _, current = get_record(db, resource, key)
            if dict(current) != snapshot:
                raise HTTPException(409, "Record changed during processing; result was not applied")
            if resource == "interviews":
                app = db.get(Application, snapshot["application_id"])
                job, resume = db.get(Job, app.job_id), db.get(Resume, app.resume_id)
                if app.status in ("hired", "withdrawn", "rejected") or job.revision != input_revision or resume.text != input_text:
                    raise HTTPException(409, "Interview inputs changed during processing; result was not applied")
            if resource == "candidates":
                db.get(Candidate, key).parsed_profile = generated
            elif resource == "matches":
                db.get(Match, key).roadmap = generated
            elif resource == "interviews":
                db.get(HiringInterview, key).questions = generated
            elif generated != snapshot["text"]:
                # Changed extraction invalidates old scoring inputs; retain uploaded bytes.
                db.get(Resume, key).text = generated
                apps = list(db.scalars(select(Application).where(Application.resume_id == key)))
                for app in apps:
                    app.assessment = None
                    match = db.scalar(select(Match).where(Match.job_id == app.job_id, Match.candidate_id == app.candidate_id))
                    if match:
                        db.delete(match)
        task = db.get(DevTask, task_id)
        task.status, task.result = "completed", {"resource": resource, "record_id": key}
        if resource == "applications" and source_kind and previous_match is None:
            db.flush()
            new_match = db.scalar(select(Match.id).where(Match.candidate_id == snapshot["candidate_id"], Match.job_id == snapshot["job_id"]))
            if new_match:
                labels = labels_for(db)
                labels[f"matches:{new_match}"] = source_kind
                save_labels(db, labels)
        record(db, user, "platform.rerun.completed", f"{resource}:{key}", {"reason": body.reason, "task_id": task_id, "result": "success"})
        db.commit()
    except Exception as exc:
        db.rollback()
        task = db.get(DevTask, task_id)
        task.status, task.result = "failed", {"resource": resource, "record_id": key, "error_type": type(exc).__name__}
        record(db, user, "platform.rerun.failed", f"{resource}:{key}", {"reason": body.reason, "task_id": task_id, "result": "failed", "error_type": type(exc).__name__})
        db.commit()
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(502, "Processing failed. Inspect AI operations and retry the selected record.") from exc
    return {"task_id": task_id, "status": "completed"}


@router.get("/overview")
def overview(db: Session = Depends(get_db)):
    counts = {name: db.scalar(select(func.count()).select_from(table_for(name))) for name in RESOURCES}
    counts.update({role: db.scalar(select(func.count()).select_from(User).where(User.role == role))
                   for role in ("candidate", "recruiter", "developer", "superadmin")})
    counts.update({f"jobs_{state}": db.scalar(select(func.count()).select_from(Job).where(Job.status == state)) for state in ("draft", "ready", "closed")})
    counts.update({state: db.scalar(select(func.count()).select_from(Application).where(Application.status == state)) for state in ("hired", "rejected")})
    counts["resume_bytes"] = db.scalar(select(func.coalesce(func.sum(func.length(Resume.content)), 0)))
    policy = db.get(RuntimeConfig, "platform.registrations")
    return {"counts": counts, "maintenance": operations.maintenance,
            "registrations_enabled": not policy or policy.value.get("enabled", True),
            "marked_records": len(labels_for(db))}


@router.get("/records/{resource}")
def records(resource: str, q: str = "", role: str = "", status: str = "", company_id: int | None = None,
            since: datetime | None = None, until: datetime | None = None, kind: Literal["ALL", "REAL", "TEST", "DEMO"] = "ALL",
            offset: int = Query(0, ge=0), db: Session = Depends(get_db)):
    table, labels = table_for(resource), labels_for(db)
    pk = next(iter(table.primary_key.columns))
    query = select(table)
    if q:
        clauses = [table.c[name].ilike(f"%{q[:200]}%") for name in ("full_name", "name", "title", "email", "public_id", "filename", "job_title", "agent", "model") if name in table.c]
        if q.isdigit():
            clauses.append(pk == int(q))
        if clauses:
            query = query.where(or_(*clauses))
    if role and "role" in table.c:
        query = query.where(table.c.role == role)
    if status:
        if "status" in table.c:
            query = query.where(table.c.status == status)
        elif "disabled" in table.c:
            query = query.where(func.coalesce(table.c.disabled, False) == (status == "disabled"))
    if company_id is not None:
        if "company_id" in table.c:
            query = query.where(table.c.company_id == company_id)
        elif "job_id" in table.c:
            query = query.where(table.c.job_id.in_(select(Job.id).where(Job.company_id == company_id)))
    if "created_at" in table.c:
        if since:
            query = query.where(table.c.created_at >= since)
        if until:
            query = query.where(table.c.created_at <= until)
    if kind != "ALL":
        marked = [int(key.split(":")[1]) for key, value in labels.items() if key.startswith(f"{table.name}:") and (kind == "REAL" or value == kind)]
        query = query.where(pk.not_in(marked) if kind == "REAL" else pk.in_(marked))
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.execute(query.order_by(pk.desc()).offset(offset).limit(50)).mappings()
    return {"rows": [serialize(row, table, labels) for row in rows], "total": total, "offset": offset, "limit": 50}


@router.get("/records/{resource}/{key}")
def detail(resource: str, key: int, user=Depends(require_superadmin), db: Session = Depends(get_db)):
    result = footprint(db, resource, key)
    audit = list(db.scalars(select(AuditLog).where(AuditLog.target == f"{resource}:{key}").order_by(AuditLog.id.desc()).limit(100)))
    if resource == "users":
        audit += list(db.scalars(select(AuditLog).where(or_(AuditLog.actor_id == key,
            (AuditLog.target == str(key)) & AuditLog.action.like("user.%"))).order_by(AuditLog.id.desc()).limit(100)))
    result["audit"] = [{"actor_id": r.actor_id, "action": r.action, "details": r.details, "created_at": r.created_at} for r in audit]
    record(db, user, "platform.inspect", f"{resource}:{key}", {"resource_type": resource, "result": "success"})
    db.commit()
    return result


@router.get("/resumes/{key}/download")
def download(key: int, user=Depends(require_superadmin), db: Session = Depends(get_db)):
    resume = db.get(Resume, key)
    if not resume:
        raise HTTPException(404, "Resume not found")
    record(db, user, "platform.resume_download", f"resumes:{key}", {"result": "success"})
    db.commit()
    return Response(resume.content, media_type="application/octet-stream", headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(resume.filename, safe='')}"})


class Operation(BaseModel):
    action: Literal["delete", "reset", "clear_ai", "test_reset", "test_ai", "label", "status", "edit_job", "revoke_all_sessions", "registrations"]
    resource: str = "users"
    record_id: int = Field(default=0, ge=0)
    value: str = Field(default="", max_length=30)
    test_only: bool = False
    job: JobIn | None = None

    @model_validator(mode="after")
    def allowed_action(self):
        table_for(self.resource)
        if self.action not in ("test_reset", "test_ai", "revoke_all_sessions", "registrations") and self.record_id < 1:
            raise ValueError("Select a record")
        if self.action == "label" and self.value not in ("REAL", "TEST", "DEMO"):
            raise ValueError("Select REAL, TEST or DEMO")
        allowed_status = {"jobs": {"draft", "ready", "closed"}, "applications": {"applied", "screened", "shortlisted", "interview", "offer", "hired", "rejected", "withdrawn"}}
        if self.action == "status" and self.value not in allowed_status.get(self.resource, set()):
            raise ValueError("Invalid administrative status")
        if self.action == "registrations" and self.value not in ("enabled", "disabled"):
            raise ValueError("Choose enabled or disabled")
        if self.action == "edit_job" and (self.resource != "jobs" or self.job is None):
            raise ValueError("Provide a validated job draft")
        return self


@router.post("/preview")
def preview(body: Operation, user=Depends(require_superadmin), db: Session = Depends(get_db)):
    try:
        plan = plan_operation(db, user, body)
    except HTTPException as exc:
        record(db, user, "platform.preview.refused", f"{body.resource}:{body.record_id}",
               {"result": "refused", "action": body.action, "status": exc.status_code})
        db.commit()
        raise
    expires = datetime.now(UTC) + timedelta(minutes=10)
    phrase = f"CONFIRM {body.action.upper()} {body.resource.upper()} {body.record_id}" if body.record_id else f"CONFIRM {body.action.upper()}"
    nonce = secrets.token_hex(16)
    token = jwt.encode({"aud": "platform-operation", "actor": user.id, "sid": user.session_key,
        "ver": user.token_version or 0, "selection": body.model_dump(), "digest": plan["digest"], "phrase": phrase,
        "nonce": nonce, "exp": expires}, SECRET_KEY, algorithm=ALGORITHM)
    record(db, user, "platform.preview", f"{body.resource}:{body.record_id}", {"resource_type": body.resource, "action": body.action, "counts": plan["counts"], "result": "success"})
    db.commit()
    return {"token": token, "confirmation": phrase, "counts": plan["counts"], "total": sum(plan["counts"].values()),
            "retained_staff": plan["retained_staff"], "detached_memberships": plan["detach"], "expires_at": expires,
            "bytes": plan["bytes"], "records": plan["ids"], "updates": plan["updates"]}


@router.post("/execute")
def execute(body: CleanupExecute, user=Depends(require_superadmin), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(body.token, SECRET_KEY, algorithms=[ALGORITHM], audience="platform-operation")
    except jwt.PyJWTError:
        raise HTTPException(409, "Preview expired or invalid. Generate a new preview.")
    if (payload["actor"], payload["sid"], payload["ver"]) != (user.id, user.session_key, user.token_version or 0):
        raise HTTPException(403, "Preview belongs to another administrator session")
    if body.confirmation != payload["phrase"] or not body.backup_confirmed or len(body.reason.strip()) < 3:
        raise HTTPException(422, "Confirm the exact phrase, reason and acknowledgement")
    selection = Operation(**payload["selection"])
    target = f"{selection.resource}:{selection.record_id}"
    with operations.lock, task_lock:
        if operations.cleanup_running or operations.active_requests > 1:
            raise HTTPException(409, "Wait for other requests to finish and retry")
        if not operations.maintenance:
            raise HTTPException(409, "Enable maintenance mode before platform mutations")
        operations.cleanup_running = True
        try:
            lock_database(db)
            reauthenticate(db, user, body.password)
            if db.scalar(select(DevTask.id).where(DevTask.status == "running").limit(1)):
                raise HTTPException(409, "Wait for running maintenance tasks")
            if db.scalar(select(AuditLog.id).where(AuditLog.action == "platform.executed", AuditLog.target == payload["nonce"])):
                raise HTTPException(409, "Operation already executed")
            plan = plan_operation(db, user, selection)
            if plan["digest"] != payload["digest"]:
                raise HTTPException(409, "Impact changed. Generate a new preview.")
            execute_plan(db, plan)
            apply_updates(db, user, selection, body.reason, plan)
            record(db, user, "platform.executed", payload["nonce"], {"result": "success", "resource_type": selection.resource,
                "resource_id": selection.record_id, "reason": body.reason, "counts": plan["counts"]})
            record(db, user, f"platform.{selection.action}", target, {"result": "success", "resource_type": selection.resource,
                "reason": body.reason, "selection": selection.model_dump(), "counts": plan["counts"]})
            db.commit()
        except Exception as exc:
            db.rollback()
            record(db, user, f"platform.{selection.action}.failed", target, {"result": "failed", "reason": body.reason, "error_type": type(exc).__name__})
            db.commit()
            raise
        finally:
            operations.cleanup_running = False
    return {"total": sum(plan["counts"].values()), "maintenance": operations.maintenance}


def apply_updates(db, actor, selection, reason, plan):
    action, resource, key = selection.action, selection.resource, selection.record_id
    if action == "label":
        labels = labels_for(db)
        label = f"{RESOURCES[resource]}:{key}"
        if selection.value == "REAL":
            labels.pop(label, None)
        else:
            labels[label] = selection.value
        save_labels(db, labels)
    elif action == "registrations":
        row = db.get(RuntimeConfig, "platform.registrations")
        if row is None:
            row = RuntimeConfig(key="platform.registrations", value={})
            db.add(row)
        row.value = {"enabled": selection.value == "enabled"}
    elif action == "revoke_all_sessions":
        db.execute(update(User).where(User.id != actor.id).values(token_version=func.coalesce(User.token_version, 0) + 1))
        db.execute(update(ImpersonationSession).values(revoked=True))
    elif action == "edit_job":
        row = db.get(Job, key)
        draft = selection.job
        company = db.get(Company, row.company_id) if row.company_id else None
        if draft.status == "ready" and (not company or company.active is False or not draft.markdown.strip()):
            raise HTTPException(409, "Publishing requires an active company and description")
        description = {"markdown": draft.markdown, "requirements": draft.requirements.model_dump()}
        if row.title != draft.title or row.description != description:
            row.revision = (row.revision or 1) + 1
        for field, value in draft.model_dump(exclude={"markdown", "requirements"}).items():
            setattr(row, field, value)
        row.description = description
    elif action == "status":
        if resource == "applications":
            row = db.get(Application, key)
            change_status(row, selection.value, f"Superadmin override by #{actor.id}: {reason}")
        else:
            row = db.get(Job, key)
            company = db.get(Company, row.company_id) if row.company_id else None
            if selection.value == "ready" and (not company or company.active is False or not (row.description or {}).get("markdown", "").strip()):
                raise HTTPException(409, "Publishing requires an active company and job description")
            row.status = selection.value
    elif action in ("reset", "clear_ai", "delete", "test_ai", "test_reset"):
        for name, identifier in plan["updates"]:
            if name == "users":
                row = db.get(User, identifier)
                row.token_version = (row.token_version or 0) + 1
            elif name == "candidates":
                row = db.get(Candidate, identifier)
                row.parsed_profile = None
                if action == "reset" or (action == "delete" and resource == "resumes"):
                    row.resume_text, row.stage = "", "applied"
            elif name == "applications":
                row = db.get(Application, identifier)
                row.assessment = None
                if action == "reset":
                    change_status(row, "applied", f"Superadmin reset by #{actor.id}: {reason}")
            elif name == "hiring_interviews":
                db.get(HiringInterview, identifier).questions = None


@router.get("/integrity")
def integrity(db: Session = Depends(get_db)):
    return integrity_report(db)


@router.get("/sessions")
def sessions(db: Session = Depends(get_db)):
    rows = list(db.scalars(select(ImpersonationSession).order_by(ImpersonationSession.expires_at.desc()).limit(100)))
    return {"ordinary_sessions": "Stateless JWT: individual device sessions and last-login times are not recorded. User session revocation invalidates all their tokens.",
        "impersonations": [{"id": r.id, "actor_id": r.actor_id, "user_id": r.user_id, "expires_at": r.expires_at, "revoked": r.revoked} for r in rows]}


@router.get("/health")
def health(db: Session = Depends(get_db)):
    import os
    import httpx
    from app.services.resume_text import MAX_BYTES
    settings = get_settings()
    start = time.perf_counter()
    db.scalar(select(func.count()).select_from(User))
    database_ms = round((time.perf_counter() - start) * 1000, 1)
    parsed = urlsplit(settings.ollama_base_url)
    safe_url = urlunsplit((parsed.scheme, (parsed.hostname or "localhost") + (f":{parsed.port}" if parsed.port else ""), parsed.path, "", ""))
    start = time.perf_counter()
    ollama = "unavailable"
    try:
        response = httpx.get(f"{safe_url.removesuffix('/v1').rstrip('/')}/api/tags", timeout=2, follow_redirects=False)
        if response.status_code == 200:
            ollama = "available"
    except (httpx.HTTPError, ValueError):
        pass
    cache = settings.llm_cache_dir
    files = [p for p in cache.glob("*.json") if p.is_file() and not p.is_symlink()]
    return {"backend": "available", "database": db.bind.dialect.name, "database_ms": database_ms,
            "ollama": ollama, "ollama_ms": round((time.perf_counter() - start) * 1000, 1), "ollama_url": safe_url,
            "ollama_model": settings.ollama_model or "See LLM routing configuration", "version": os.environ.get("APP_VERSION", "unversioned"),
            "environment": os.environ.get("APP_ENV", "development"), "resume_storage": "database binary", "resume_upload_limit_bytes": MAX_BYTES,
            "cache_files": len(files), "cache_bytes": sum(p.stat().st_size for p in files),
            "cache_directory_present": cache.is_dir(), "cache_writable": os.access(cache, os.W_OK),
            "maintenance_scope": "Existing single-process admission control; run one API worker during destructive maintenance."}


class Seed(Reason):
    candidates: int = Field(default=3, ge=1, le=20)
    kind: Literal["TEST", "DEMO"] = "DEMO"


@router.post("/seed", status_code=201)
def seed(body: Seed, user=Depends(require_superadmin), db: Session = Depends(get_db)):
    with operations.lock:
        lock_database(db)
        labels = labels_for(db)
        suffix = secrets.token_hex(6)
        company = Company(name=f"{body.kind} Meridian {suffix}", industry="Software", about="Fictional development workspace")
        db.add(company)
        db.flush()
        recruiter = User(email=f"hr-{suffix}@example.invalid", full_name="Demo Recruiter", role="recruiter", company_id=company.id,
                         password_hash=hash_password(secrets.token_urlsafe(32)), disabled=True)
        db.add(recruiter)
        db.flush()
        job = Job(title="Demo Backend Engineer", brief="Build Python services", status="draft", creator_id=recruiter.id, company_id=company.id,
                  description={"markdown": "Build Python APIs and review code.", "requirements": {"must_have_skills": ["Python", "SQL"], "nice_to_have_skills": [], "min_years_experience": 2, "education": None, "responsibilities": ["Build APIs"]}})
        db.add(job)
        db.flush()
        created = [("companies", company.id), ("users", recruiter.id), ("jobs", job.id)]
        for i in range(body.candidates):
            email = f"candidate-{suffix}-{i}@example.invalid"
            candidate = Candidate(name=f"Demo Candidate {i + 1}", email=email)
            db.add(candidate)
            db.flush()
            account = User(email=email, full_name=candidate.name, role="candidate", candidate_id=candidate.id,
                           disabled=True, password_hash=hash_password(secrets.token_urlsafe(32)))
            db.add(account)
            db.flush()
            text = f"{candidate.name}\nExperience\nBuilt Python and SQL APIs for {i + 2} years.\nEducation\nBSc Computer Science\nProjects\nInventory API"
            resume = Resume(user_id=account.id, filename="demo-resume.txt", content=text.encode(), text=text)
            db.add(resume)
            db.flush()
            application = Application(user_id=account.id, candidate_id=candidate.id, resume_id=resume.id, job_id=job.id, job_title=job.title)
            db.add(application)
            db.flush()
            created.extend([("candidates", candidate.id), ("users", account.id), ("candidate_resumes", resume.id), ("applications", application.id)])
        for table, key in created:
            labels[f"{table}:{key}"] = body.kind
        save_labels(db, labels)
        record(db, user, "platform.seed", f"companies:{company.id}", {"result": "success", "reason": body.reason, "kind": body.kind, "created": created})
        db.commit()
    return {"company_id": company.id, "created": len(created), "accounts_disabled": True}
