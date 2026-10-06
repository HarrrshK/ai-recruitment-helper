"""Allowlisted, dependency-aware deletion plans. Never execute browser-supplied SQL."""
import hashlib
import json

from fastapi import HTTPException
from sqlalchemy import delete, select, update

from app.db import Base
from app.models import User
from app.services.permissions import STAFF_ROLES

GROUPS = {
    "users": ("users",),
    "companies": ("companies",),
    "jobs": ("jobs",),
    "candidates": ("candidates",),
    "profiles": ("candidate_profiles",),
    "resumes": ("candidate_resumes",),
    "applications": ("applications",),
    "matches": ("matches",),
    "interviews": ("interviews", "hiring_interviews"),
    "messages": ("messages", "application_messages"),
    "qa": ("qa_entries",),
    "invites": ("company_invites",),
    "sessions": ("impersonation_sessions",),
    "password_resets": ("password_reset_tokens",),
    "telemetry": ("agent_runs", "llm_events"),
    "vectors": ("embedding_entries",),
    "prompts": ("prompt_versions",),
    "configuration": ("runtime_config",),
    "tasks": ("dev_tasks",),
}


def chunks(values, size=400):
    values = list(values)
    for start in range(0, len(values), size):
        yield values[start:start + size]


def build_plan(db, groups, actor, user_id=None, company_id=None, job_id=None, *, seeds=None, preserve=None):
    tables = Base.metadata.tables
    ids = {name: set() for name in tables if name != "audit_logs"}
    protected = set(db.scalars(select(User.id).where(User.role.in_(STAFF_ROLES))))
    if seeds is not None:
        for name, values in seeds.items():
            ids[name].update(values)
        ids["users"] -= protected
    elif user_id is not None:
        target = db.get(User, user_id)
        if not target:
            raise HTTPException(404, "User not found")
        if target.id == actor.id:
            raise HTTPException(409, "You cannot delete your own account")
        if target.role in STAFF_ROLES and actor.role != "superadmin":
            raise HTTPException(403, "Only superadmins can delete staff accounts")
        protected.discard(target.id)
        ids["users"].add(target.id)
    elif company_id is not None or job_id is not None:
        name, key = ("companies", company_id) if company_id is not None else ("jobs", job_id)
        if not db.scalar(select(tables[name].c.id).where(tables[name].c.id == key)):
            raise HTTPException(404, "Record not found")
        ids[name].add(key)
    else:
        for group in groups:
            for name in GROUPS[group]:
                pk = next(iter(tables[name].primary_key.columns))
                ids[name].update(db.scalars(select(pk)))
        ids["users"] -= protected
        ids["runtime_config"].discard("maintenance")

    # Follow dependent foreign keys, plus the legacy messages.job_id logical link.
    changed = True
    while changed:
        before = sum(map(len, ids.values()))
        for batch in chunks(ids["users"]):
            ids["candidates"].update(v for v in db.scalars(select(User.candidate_id).where(User.id.in_(batch))) if v is not None)
        for name, table in tables.items():
            if name not in ids:
                continue
            pk = next(iter(table.primary_key.columns))
            for fk in table.foreign_keys:
                for batch in chunks(ids.get(fk.column.table.name, set())):
                    found = set(db.scalars(select(pk).where(fk.parent.in_(batch))))
                    ids[name].update(found - protected if name == "users" else found)
        for batch in chunks(ids["jobs"]):
            table = tables["messages"]
            ids["messages"].update(db.scalars(select(table.c.id).where(table.c.job_id.in_(batch))))
        changed = sum(map(len, ids.values())) != before

    for name, values in (preserve or {}).items():
        ids[name].difference_update(values)

    # Retained staff may have a candidate profile or company membership that is removed.
    detach = {"candidate_id": [], "company_id": []}
    for column, name in (("candidate_id", "candidates"), ("company_id", "companies")):
        for batch in chunks(ids[name]):
            detach[column].extend(db.scalars(select(User.id).where(User.id.not_in(ids["users"]), getattr(User, column).in_(batch))))
    ids = {name: sorted(values) for name, values in ids.items() if values}
    detach = {key: sorted(set(value)) for key, value in detach.items() if value}
    digest = hashlib.sha256(json.dumps({"ids": ids, "detach": detach}, sort_keys=True).encode()).hexdigest()
    return {"ids": ids, "detach": detach, "digest": digest,
            "counts": {name: len(values) for name, values in sorted(ids.items())},
            "retained_staff": len(protected), "detached_memberships": detach}


def execute_plan(db, plan):
    # Labels are metadata, not an independent copy of application data.
    from app.models import RuntimeConfig
    labels = db.get(RuntimeConfig, "platform.labels")
    if labels and "platform.labels" not in plan["ids"].get("runtime_config", []):
        removed = {f"{name}:{key}" for name, keys in plan["ids"].items() for key in keys}
        labels.value = {key: value for key, value in labels.value.items() if key not in removed}
    for column, users in plan["detach"].items():
        for batch in chunks(users):
            db.execute(update(User).where(User.id.in_(batch)).values({column: None}), execution_options={"synchronize_session": False})
    for table in reversed(Base.metadata.sorted_tables):
        if table.name == "audit_logs":
            continue
        pk = next(iter(table.primary_key.columns))
        for batch in chunks(plan["ids"].get(table.name, [])):
            db.execute(delete(table).where(pk.in_(batch)))


def lock_database(db):
    # Establish a write snapshot before recomputing a confirmation plan.
    db.rollback()
    from sqlalchemy import text
    if db.bind.dialect.name == "sqlite":
        db.execute(text("BEGIN IMMEDIATE"))
    elif db.bind.dialect.name == "postgresql":
        names = ", ".join(f'"{name}"' for name in sorted(Base.metadata.tables))
        db.execute(text(f"LOCK TABLE {names} IN SHARE ROW EXCLUSIVE MODE"))
    else:
        raise HTTPException(409, "Cleanup supports SQLite and PostgreSQL only")
