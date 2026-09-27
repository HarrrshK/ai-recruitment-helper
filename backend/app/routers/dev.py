import difflib
import hashlib
import json
import secrets
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.auth import create_access_token, require_developer
from app.config import get_settings
from app.db import Base, get_db, get_session_factory
from app.llm.client import get_llm
from app.llm.runtime import PROVIDERS, RoutingConfig, provider_settings
from app.models import AgentRun, AuditLog, Candidate, Company, CompanyInvite, DevTask, EmbeddingEntry, ImpersonationSession, Job, LLMEvent, PromptVersion, RuntimeConfig, User
from app.prompts import _DIR
from app.routers.recruiter import CompanyIn, company_out
from app.services.audit import record
from app.services.permissions import DEFAULT_PERMISSIONS, RECRUITER_PERMISSIONS, STAFF_ROLES, permissions_for
from app.services.workspaces import issue_invite
from app.services.embeddings import get_embedder, MODEL_NAME, MODEL_DIR
from app.services.dev_tasks import benchmark, executor, reindex, run_task, task_lock

router = APIRouter(prefix="/api/dev", tags=["developer"], dependencies=[Depends(require_developer)])


def user_out(user):
    return {"id": user.id, "public_id": user.public_id, "email": user.email, "full_name": user.full_name, "role": user.role,
            "company_id": user.company_id, "candidate_id": user.candidate_id, "disabled": bool(user.disabled), "permissions": permissions_for(user) if user.role == "recruiter" else []}


@router.get("/overview")
def overview(db: Session = Depends(get_db)):
    return {"companies": db.scalar(select(func.count()).select_from(Company)), "users": db.scalar(select(func.count()).select_from(User)),
            "jobs": db.scalar(select(func.count()).select_from(Job)), "calls": db.scalar(select(func.count()).select_from(AgentRun)),
            "permissions": list(RECRUITER_PERMISSIONS)}


@router.get("/companies")
def companies(db: Session = Depends(get_db)):
    return [{**company_out(c), "active": c.active is not False, "knowledge": c.knowledge or ""} for c in db.scalars(select(Company).order_by(Company.id.desc()))]


class CompanyBody(CompanyIn):
    active: bool = True


@router.post("/companies", status_code=201)
def create_company(body: CompanyBody, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    company = Company(**body.model_dump())
    db.add(company)
    db.flush()
    record(db, user, "company.create", company.id, {"name": company.name})
    db.commit()
    return {**company_out(company), "active": company.active, "knowledge": ""}


@router.put("/companies/{company_id}")
def edit_company(company_id: int, body: CompanyBody, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    company = db.get(Company, company_id)
    if not company:
        raise HTTPException(404, "Company not found")
    for key, value in body.model_dump().items():
        setattr(company, key, value)
    record(db, user, "company.update", company.id, {"active": body.active})
    db.commit()
    return {**company_out(company), "active": company.active, "knowledge": company.knowledge or ""}


@router.delete("/companies/{company_id}", status_code=204)
def delete_company(company_id: int, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    company = db.get(Company, company_id)
    if not company:
        raise HTTPException(404, "Company not found")
    if any(db.scalar(select(model.id).where(model.company_id == company_id).limit(1)) for model in (User, Job, CompanyInvite)):
        raise HTTPException(409, "Company has members, jobs or invitations. Suspend it instead.")
    record(db, user, "company.delete", company_id)
    db.delete(company)
    db.commit()


@router.post("/companies/{company_id}/knowledge")
async def knowledge(company_id: int, file: UploadFile, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    company = db.get(Company, company_id)
    if not company:
        raise HTTPException(404, "Company not found")
    raw = await file.read(200001)
    if len(raw) > 200000 or not (file.filename or "").lower().endswith(".md"):
        raise HTTPException(422, "Upload a Markdown file up to 200 KB")
    try:
        company.knowledge = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(422, "Use UTF-8 Markdown")
    record(db, user, "company.knowledge", company_id, {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
    db.commit()
    return {"knowledge": company.knowledge}


class InviteBody(BaseModel):
    company_id: int
    email: EmailStr
    days: int = Field(default=7, ge=1, le=30)
    permissions: list[str] = Field(default_factory=lambda: DEFAULT_PERMISSIONS.copy())

    @field_validator("permissions")
    @classmethod
    def known_permissions(cls, value):
        if not set(value).issubset(RECRUITER_PERMISSIONS):
            raise ValueError("Unknown company permission")
        return sorted(set(value))


@router.get("/invites")
def invites(db: Session = Depends(get_db)):
    return [{"id": i.id, "company_id": i.company_id, "email": i.email, "expires_at": i.expires_at, "accepted_at": i.accepted_at,
             "permissions": i.permissions if i.permissions is not None else DEFAULT_PERMISSIONS} for i in db.scalars(select(CompanyInvite).order_by(CompanyInvite.id.desc()).limit(200))]


@router.post("/invites", status_code=201)
def invite(body: InviteBody, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    company = db.get(Company, body.company_id)
    if not company or company.active is False:
        raise HTTPException(422, "Choose an active company")
    code = issue_invite(db, body.company_id, str(body.email), body.days, body.permissions)
    record(db, user, "invite.create", body.company_id, {"email": str(body.email), "days": body.days, "permissions": body.permissions})
    db.commit()
    return {"code": code}


@router.delete("/invites/{invite_id}", status_code=204)
def revoke_invite(invite_id: int, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    row = db.get(CompanyInvite, invite_id)
    if not row or row.accepted_at:
        raise HTTPException(409, "Unused invitation not found")
    record(db, user, "invite.revoke", invite_id)
    db.delete(row)
    db.commit()


@router.get("/users")
def users(q: str = "", offset: int = Query(0, ge=0), role: Literal["candidate", "recruiter", "developer", "superadmin"] | None = None,
          disabled: bool | None = None, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    query = select(User).where(or_(User.email.ilike(f"%{q[:100]}%"), User.full_name.ilike(f"%{q[:100]}%"), User.public_id.ilike(f"%{q[:100]}%")))
    if role:
        query = query.where(User.role == role)
    if disabled is not None:
        query = query.where(User.disabled.is_(True) if disabled else or_(User.disabled.is_(False), User.disabled.is_(None)))
    record(db, user, "users.inspect", "users", {"offset": offset})
    rows = list(db.scalars(query.order_by(User.id.desc()).offset(offset).limit(100)))
    db.commit()
    return [user_out(row) for row in rows]


class UserBody(BaseModel):
    role: Literal["developer", "superadmin", "recruiter", "candidate"]
    disabled: bool = False
    permissions: list[str] = Field(default_factory=list)
    reason: str = Field(min_length=3, max_length=500)
    _permissions = field_validator("permissions")(InviteBody.known_permissions.__func__)


@router.patch("/users/{user_id}")
def edit_user(user_id: int, body: UserBody, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "User not found")
    if user.id == target.id:
        raise HTTPException(409, "Self role and access changes are not allowed")
    if user.role != "superadmin" and (target.role in STAFF_ROLES or body.role in STAFF_ROLES):
        raise HTTPException(403, "Only superadmins can modify developer or superadmin access")
    if body.role == "recruiter" and not target.company_id:
        raise HTTPException(409, "Recruiter access requires company membership through an invitation")
    previous = user_out(target)
    target.role, target.disabled, target.permissions = body.role, body.disabled, body.permissions
    target.token_version = (target.token_version or 0) + 1
    if body.role == "candidate" and not target.candidate_id:
        candidate = Candidate(name=target.full_name or target.email, email=target.email)
        db.add(candidate)
        db.flush()
        target.candidate_id = candidate.id
    record(db, user, "user.access", target.id, {"before": previous, "after": user_out(target), "reason": body.reason})
    db.commit()
    return user_out(target)


class ImpersonateBody(BaseModel):
    role: Literal["recruiter", "candidate"]
    reason: str = Field(min_length=3, max_length=500)


@router.post("/users/{user_id}/impersonate")
def impersonate(user_id: int, body: ImpersonateBody, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if not target or target.disabled or target.role in STAFF_ROLES:
        raise HTTPException(403, "Only active recruiter or candidate accounts can be impersonated")
    if (body.role == "recruiter" and target.role != "recruiter") or (body.role == "candidate" and not target.candidate_id):
        raise HTTPException(422, "This account does not have the selected workspace")
    session = ImpersonationSession(id=secrets.token_urlsafe(24), actor_id=user.id, user_id=target.id,
        actor_version=user.token_version or 0, expires_at=datetime.now(UTC) + timedelta(minutes=15))
    db.add(session)
    record(db, user, "impersonation.start", target.id, {"session": session.id, "role": body.role, "reason": body.reason})
    db.commit()
    token = create_access_token({"sub": str(target.id), "role": body.role, "ver": target.token_version or 0, "sid": target.session_key, "imp": session.id}, timedelta(minutes=15))
    return {"access_token": token, "user": {**user_out(target), "role": body.role, "candidate_id": target.candidate_id, "impersonation_id": session.id}}


@router.delete("/impersonations/{session_id}", status_code=204)
def stop_impersonation(session_id: str, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    row = db.get(ImpersonationSession, session_id)
    if not row or (row.actor_id != user.id and user.role != "superadmin"):
        raise HTTPException(404, "Session not found")
    row.revoked = True
    record(db, user, "impersonation.end", row.user_id, {"session": row.id})
    db.commit()


@router.get("/llm/config")
def llm_config(db: Session = Depends(get_db)):
    row = db.get(RuntimeConfig, "llm")
    settings = get_settings()
    value = row.value if row else {"primary": {"provider": "groq", "large_model": settings.llm_model_large, "small_model": settings.llm_model_small, "cost_per_million": None}, "fallback": None}
    return {**value, "revision": row.revision if row else 0, "providers": [{"name": p, "key_env": info[1]} for p, info in PROVIDERS.items()]}


@router.put("/llm/config")
def save_llm_config(body: RoutingConfig, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    for item in (body.primary, body.fallback):
        if item and not provider_settings(item).llm_api_key:
            raise HTTPException(422, f"Configure {PROVIDERS[item.provider][1]} on the server first")
    row = db.get(RuntimeConfig, "llm")
    if (row.revision if row else 0) != body.revision:
        raise HTTPException(409, "Configuration changed. Reload before saving.")
    if not row:
        row = RuntimeConfig(key="llm", value=body.model_dump(exclude={"revision"}), revision=1)
        db.add(row)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "Configuration changed. Reload before saving.")
    else:
        changed = db.execute(update(RuntimeConfig).where(RuntimeConfig.key == "llm", RuntimeConfig.revision == body.revision).values(value=body.model_dump(exclude={"revision"}), revision=body.revision + 1))
        if changed.rowcount != 1:
            raise HTTPException(409, "Configuration changed. Reload before saving.")
        db.refresh(row)
    record(db, user, "llm.configure", "llm", {"revision": row.revision, "configuration": row.value})
    db.commit()
    return llm_config(db)


def prompt_name(name):
    name = "qa" if name in ("qa_bot", "qa_bot.md") else name.removesuffix(".md")
    if name not in {p.stem for p in _DIR.glob("*.md")}:
        raise HTTPException(404, "Prompt not found")
    return name


@router.get("/prompts")
def prompts():
    return [{"name": p.stem, "file": "qa_bot.md" if p.stem == "qa" else p.name} for p in sorted(_DIR.glob("*.md"))]


@router.get("/prompts/{name}")
def prompt(name: str, db: Session = Depends(get_db)):
    name = prompt_name(name)
    versions = list(db.scalars(select(PromptVersion).where(PromptVersion.name == name).order_by(PromptVersion.id.desc()).limit(100)))
    baseline = (_DIR / f"{name}.md").read_text().strip()
    return {"name": name, "baseline": baseline, "content": versions[0].content if versions else baseline, "revision": versions[0].id if versions else 0,
            "versions": [{"id": v.id, "content": v.content, "note": v.note, "author_id": v.author_id, "created_at": v.created_at} for v in versions]}


class PromptBody(BaseModel):
    content: str = Field(min_length=10, max_length=50000)
    note: str = Field(min_length=3, max_length=500)
    revision: int = 0


@router.put("/prompts/{name}")
def save_prompt(name: str, body: PromptBody, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    name = prompt_name(name)
    current = prompt(name, db)
    if body.revision != current["revision"]:
        raise HTTPException(409, "Prompt changed. Reload before saving.")
    version = PromptVersion(name=name, base_revision=body.revision, content=body.content, author_id=user.id, note=body.note)
    db.add(version)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Prompt changed. Reload before saving.")
    record(db, user, "prompt.edit", name, {"version": version.id, "note": body.note, "sha256": hashlib.sha256(body.content.encode()).hexdigest()})
    db.commit()
    return prompt(name, db)


class PromptTest(BaseModel):
    content: str = Field(min_length=10, max_length=50000)
    input: str = Field(min_length=1, max_length=15000)


class DiffBody(BaseModel):
    left: str = Field(max_length=50000)
    right: str = Field(max_length=50000)


@router.post("/prompts/{name}/diff")
def prompt_diff(name: str, body: DiffBody):
    prompt_name(name)
    left, right = body.left.splitlines(), body.right.splitlines()
    rows = []
    for kind, a, b, c, d in difflib.SequenceMatcher(None, left, right).get_opcodes():
        for i in range(max(b - a, d - c)):
            rows.append({"kind": kind, "left": left[a + i] if a + i < b else "", "right": right[c + i] if c + i < d else ""})
    return rows


@router.post("/prompts/{name}/test")
def test_prompt(name: str, body: PromptTest, user: User = Depends(require_developer), db: Session = Depends(get_db), llm=Depends(get_llm)):
    name = prompt_name(name)
    record(db, user, "prompt.test", name, {"input_chars": len(body.input)})
    db.commit()
    result = llm.chat([{"role": "system", "content": body.content}, {"role": "user", "content": body.input}], agent=f"playground:{name}", use_cache=False, max_tokens=1500)
    return {"output": result.text, "model": result.model, "tokens": result.tokens, "latency_ms": result.latency_ms}


@router.get("/telemetry")
def telemetry(days: int = Query(7, ge=1, le=90), db: Session = Depends(get_db)):
    rows = list(db.scalars(select(AgentRun).where(AgentRun.created_at >= datetime.now(UTC) - timedelta(days=days)).order_by(AgentRun.id.desc()).limit(10000)))
    groups, daily = {}, {}
    buckets = [{"label": "<250 ms", "count": 0}, {"label": "250-999 ms", "count": 0}, {"label": "1-5 s", "count": 0}, {"label": ">5 s", "count": 0}]
    for row in rows:
        group = groups.setdefault(row.agent, {"agent": row.agent, "calls": 0, "cached": 0, "tokens": 0, "cost": 0, "unknown_cost_calls": 0, "latencies": []})
        group["calls"] += 1
        group["cached"] += bool(row.cached)
        group["tokens"] += row.tokens
        group["cost"] += row.estimated_cost or 0
        group["unknown_cost_calls"] += not row.cached and row.estimated_cost is None
        day = daily.setdefault(str(row.created_at.date()), {"tokens": 0, "cost": 0, "calls": 0})
        day["tokens"] += row.tokens
        day["cost"] += row.estimated_cost or 0
        day["calls"] += 1
        if not row.cached:
            group["latencies"].append(row.latency_ms)
            buckets[0 if row.latency_ms < 250 else 1 if row.latency_ms < 1000 else 2 if row.latency_ms < 5000 else 3]["count"] += 1
    for group in groups.values():
        times = sorted(group.pop("latencies"))
        group["p95_ms"] = times[min(len(times) - 1, int(len(times) * .95))] if times else 0
    return {"agents": list(groups.values()), "daily": [{"date": date, **v} for date, v in sorted(daily.items())], "latency": buckets, "sample_limit": 10000}


@router.get("/errors")
def errors(kind: str = "", agent: str = "", db: Session = Depends(get_db)):
    query = select(LLMEvent)
    if kind:
        query = query.where(LLMEvent.kind == kind)
    if agent:
        query = query.where(LLMEvent.agent == agent)
    return [{"id": e.id, "agent": e.agent, "model": e.model, "kind": e.kind, "detail": e.detail, "created_at": e.created_at} for e in db.scalars(query.order_by(LLMEvent.id.desc()).limit(200))]


@router.get("/database")
def tables(db: Session = Depends(get_db)):
    return [{"name": name, "rows": db.scalar(select(func.count()).select_from(table))} for name, table in sorted(Base.metadata.tables.items())]


@router.get("/database/{name}")
def inspect_table(name: str, offset: int = Query(0, ge=0, le=100000), user: User = Depends(require_developer), db: Session = Depends(get_db)):
    table = Base.metadata.tables.get(name)
    if table is None:
        raise HTTPException(404, "Table not found")
    hidden = {"password_hash", "token_hash", "signature", "vector", "session_key"}
    columns = [c for c in table.columns if c.name not in hidden]
    rows = db.execute(select(*columns).order_by(*table.primary_key.columns).offset(offset).limit(50)).mappings()
    def value(v):
        if isinstance(v, bytes):
            return f"[binary: {len(v)} bytes]"
        if isinstance(v, (dict, list)):
            return json.dumps(v, default=str)[:2000]
        return str(v)[:2000] if v is not None else None
    result = [{k: value(v) for k, v in row.items()} for row in rows]
    record(db, user, "database.inspect", name, {"offset": offset})
    db.commit()
    return {"columns": [c.name for c in columns], "rows": result, "offset": offset, "limit": 50}


@router.post("/cache/flush")
def flush_cache(user: User = Depends(require_developer), db: Session = Depends(get_db)):
    record(db, user, "cache.flush_requested", "llm_cache")
    db.commit()
    directory = get_settings().llm_cache_dir
    count = 0
    for path in directory.glob("*.json"):
        if path.is_file() and not path.is_symlink():
            path.unlink(missing_ok=True)
            count += 1
    record(db, user, "cache.flushed", "llm_cache", {"files": count})
    db.commit()
    return {"removed": count}


@router.get("/audit")
def audit(action: str = "", offset: int = Query(0, ge=0), db: Session = Depends(get_db)):
    query = select(AuditLog)
    if action:
        query = query.where(AuditLog.action == action)
    return [{"id": r.id, "actor_id": r.actor_id, "action": r.action, "target": r.target, "details": r.details, "created_at": r.created_at} for r in db.scalars(query.order_by(AuditLog.id.desc()).offset(offset).limit(100))]


@router.get("/vectors")
def vectors(db: Session = Depends(get_db), embedder=Depends(get_embedder)):
    return {"model": MODEL_NAME, "loaded": getattr(embedder, "_model", None) is not None,
            "model_cache_present": MODEL_DIR.exists(), "indexed": db.scalar(select(func.count()).select_from(EmbeddingEntry)),
            "storage": "SQL embedding index", "chroma": "Not configured", "cache_files": sum(1 for _ in get_settings().llm_cache_dir.glob("*.json"))}


@router.get("/tasks")
def tasks(db: Session = Depends(get_db)):
    return [{"id": t.id, "kind": t.kind, "status": t.status, "result": t.result, "created_at": t.created_at} for t in db.scalars(select(DevTask).order_by(DevTask.id.desc()).limit(30))]


@router.post("/tasks/{kind}", status_code=202)
def start_task(kind: Literal["benchmark", "reindex"], user: User = Depends(require_developer), db: Session = Depends(get_db), factory=Depends(get_session_factory), embedder=Depends(get_embedder)):
    with task_lock:
        if db.scalar(select(DevTask.id).where(DevTask.status == "running").limit(1)):
            raise HTTPException(409, "A maintenance task is already running")
        task = DevTask(kind=kind)
        db.add(task)
        db.flush()
        record(db, user, f"task.{kind}", task.id)
        db.commit()
        task_id = task.id
        executor.submit(run_task, factory, task_id, benchmark if kind == "benchmark" else lambda: reindex(factory, embedder), user.id)
    return {"id": task_id, "status": "running"}


class SyntheticBody(BaseModel):
    candidates: int = Field(default=10, ge=1, le=200)
    jobs: int = Field(default=3, ge=1, le=30)
    seed: int = Field(default=42, ge=0, le=1000000)


@router.post("/synthetic")
def synthetic(body: SyntheticBody, user: User = Depends(require_developer), db: Session = Depends(get_db)):
    import random
    rng = random.Random(body.seed)
    skills = ["Python", "SQL", "Java", "TypeScript", "Docker", "Kubernetes", "React"]
    candidates = [{"name": f"Synthetic Candidate {i + 1}", "email": f"candidate-{i + 1}@example.invalid", "resume_text": f"Synthetic Candidate {i + 1}\nBuilt services for {rng.randint(1, 12)} years using {', '.join(rng.sample(skills, 3))}."} for i in range(body.candidates)]
    jobs = [{"title": f"Synthetic Engineer {i + 1}", "requirements": {"must_have_skills": rng.sample(skills, 2), "min_years_experience": rng.randint(0, 5)}} for i in range(body.jobs)]
    record(db, user, "synthetic.generate", "download", body.model_dump())
    db.commit()
    return {"synthetic": True, "seed": body.seed, "candidates": candidates, "jobs": jobs}
