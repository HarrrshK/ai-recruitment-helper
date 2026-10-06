"""Platform inspection and allowlisted plans built on the existing cleanup engine."""
import hashlib
import json

from fastapi import HTTPException
from sqlalchemy import func, select

from app.db import Base
from app.models import Application, Candidate, Company, Job, Resume, RuntimeConfig, User
from app.services.data_cleanup import build_plan

RESOURCES = {
    "users": "users", "companies": "companies", "jobs": "jobs", "applications": "applications",
    "resumes": "candidate_resumes", "candidates": "candidates", "profiles": "candidate_profiles",
    "matches": "matches", "interviews": "hiring_interviews", "interview-simulations": "interviews",
    "panel-reviews": "panel_reviews", "qa": "qa_entries", "messages": "application_messages",
    "outreach": "messages", "ai-runs": "agent_runs", "ai-errors": "llm_events", "tasks": "dev_tasks",
}
HIDDEN = {"password_hash", "token_hash", "session_key", "signature", "vector", "input_hash"}
AI_TABLES = {"matches", "panel_reviews", "qa_entries", "agent_runs", "llm_events"}


def table_for(resource):
    if resource not in RESOURCES:
        raise HTTPException(404, "Unknown platform resource")
    return Base.metadata.tables[RESOURCES[resource]]


def labels_for(db):
    row = db.get(RuntimeConfig, "platform.labels")
    labels = {}
    for key, value in (row.value or {}).items() if row else []:
        if isinstance(value, dict) and value.get("identity") is not None and value.get("identity") == label_identity(db, key):
            labels[key] = value["kind"]
    return labels


def label_identity(db, key):
    name, identifier = key.split(":", 1)
    if name not in RESOURCES.values() or not identifier.isdigit():
        return None
    table = Base.metadata.tables[name]
    pk = next(iter(table.primary_key.columns))
    row = db.execute(select(table).where(pk == int(identifier))).mappings().first()
    if not row:
        return None
    identity = row.get("public_id") or row.get("created_at") or dict(row)
    return hashlib.sha256(json.dumps(identity, default=str, sort_keys=True).encode()).hexdigest()


def save_labels(db, labels):
    labels = {key: {"kind": kind, "identity": label_identity(db, key)} for key, kind in labels.items()}
    row = db.get(RuntimeConfig, "platform.labels")
    if row is None:
        db.add(RuntimeConfig(key="platform.labels", value=labels))
    else:
        row.value = labels
        row.revision = (row.revision or 0) + 1


def serialize(row, table, labels):
    result = {key: value for key, value in dict(row).items() if key not in HIDDEN and not isinstance(value, bytes)}
    if "content" in row and isinstance(row["content"], bytes):
        result["size_bytes"] = len(row["content"])
    pk = next(iter(table.primary_key.columns)).name
    result["data_kind"] = labels.get(f"{table.name}:{row[pk]}", "REAL")
    result["record_id"] = row[pk]
    return result


def get_record(db, resource, key):
    table = table_for(resource)
    pk = next(iter(table.primary_key.columns))
    row = db.execute(select(table).where(pk == key)).mappings().first()
    if row is None:
        raise HTTPException(404, "Record not found")
    return table, row


def footprint(db, resource, key):
    table, row = get_record(db, resource, key)
    labels = labels_for(db)
    related = {}
    # Follow foreign-key ownership links for inspection, without traversing unrelated parents.
    seeds = {table.name: {key}}
    if resource == "users" and row.get("candidate_id"):
        seeds["candidates"] = {row["candidate_id"]}
    seen = dict(seeds)
    for _ in range(len(RESOURCES)):
        changed = False
        for name in RESOURCES.values():
            child = Base.metadata.tables[name]
            pk = next(iter(child.primary_key.columns))
            for fk in child.foreign_keys:
                parent_ids = seen.get(fk.column.table.name, set())
                if not parent_ids or name in ("users", "companies"):
                    continue
                found = set(db.scalars(select(pk).where(fk.parent.in_(parent_ids))))
                extra = found - seen.get(name, set())
                if extra:
                    seen.setdefault(name, set()).update(extra)
                    changed = True
        if not changed:
            break
    for name, ids in seen.items():
        if name == table.name:
            continue
        child = Base.metadata.tables[name]
        pk = next(iter(child.primary_key.columns))
        rows = db.execute(select(child).where(pk.in_(ids)).order_by(pk).limit(200)).mappings()
        related[name] = {"total": len(ids), "rows": [serialize(r, child, labels) for r in rows]}
    if resource == "companies":
        members = db.execute(select(User.__table__).where(User.company_id == key)).mappings()
        related["members"] = {"rows": [serialize(r, User.__table__, labels) for r in members]}
    parents = {}
    for fk in table.foreign_keys:
        parent = fk.column.table
        parent_key = row[fk.parent.name]
        if parent_key is not None and parent.name in RESOURCES.values():
            parent_row = db.execute(select(parent).where(fk.column == parent_key)).mappings().first()
            if parent_row:
                parents[fk.parent.name] = serialize(parent_row, parent, labels)
    return {"record": serialize(row, table, labels), "related": related, "parents": parents,
            "limitations": ["Historical AI telemetry and Ask-HR calls have no user/resource foreign key; they are not attributed to this account.",
                            "JWT sessions are stateless. Device sessions and last-login times are not recorded."]}


def plan_operation(db, actor, selection):
    action, resource, key = selection.action, selection.resource, selection.record_id
    labels = labels_for(db)
    seeds, preserve, updates = {}, {}, []
    if action in ("test_reset", "test_ai"):
        for label, kind in labels.items():
            name, identifier = label.split(":", 1)
            if kind not in ("TEST", "DEMO") or name not in RESOURCES.values():
                continue
            if action == "test_ai" and name not in AI_TABLES:
                if name in ("candidates", "applications", "hiring_interviews"):
                    updates.append((name, int(identifier)))
                continue
            table = Base.metadata.tables[name]
            pk = next(iter(table.primary_key.columns))
            if db.scalar(select(pk).where(pk == int(identifier))) is not None:
                seeds.setdefault(name, set()).add(int(identifier))
    elif action in ("registrations", "revoke_all_sessions"):
        if action == "revoke_all_sessions":
            updates = [("users", uid) for uid in db.scalars(select(User.id).where(User.id != actor.id))]
    else:
        table, row = get_record(db, resource, key)
        if resource == "users" and key == actor.id:
            raise HTTPException(409, "Use another superadmin to modify your account")
        if action == "delete":
            seeds[table.name] = {key}
            if resource == "users":
                # Use the existing explicit-user deletion path, including staff protections.
                plan = build_plan(db, [], actor, user_id=key)
                seeds = {name: set(ids) for name, ids in plan["ids"].items()}
        elif action == "reset":
            if resource == "users":
                seeds["users"] = {key}
                preserve["users"] = {key}
                preserve["candidate_profiles"] = {key}
                if row["candidate_id"]:
                    preserve["candidates"] = {row["candidate_id"]}
                    updates.append(("candidates", row["candidate_id"]))
                updates.append(("users", key))
            elif resource == "companies":
                seeds["jobs"] = set(db.scalars(select(Job.id).where(Job.company_id == key)))
            elif resource == "jobs":
                for name in ("applications", "matches", "interviews", "qa_entries", "messages"):
                    child = Base.metadata.tables[name]
                    seeds[name] = set(db.scalars(select(child.c.id).where(child.c.job_id == key)))
            elif resource == "applications":
                seeds["hiring_interviews"] = set(db.scalars(select(Base.metadata.tables["hiring_interviews"].c.id).where(Base.metadata.tables["hiring_interviews"].c.application_id == key)))
                updates.append(("applications", key))
            else:
                raise HTTPException(422, "Reset supports users, companies, jobs and applications")
        elif action == "clear_ai":
            if resource not in ("applications", "candidates", "interviews"):
                raise HTTPException(422, "Choose an application, candidate or interview")
            updates.append((table.name, key))
        else:
            updates.append((table.name, key))
        if resource == "applications" and action in ("delete", "reset", "clear_ai"):
            match = Base.metadata.tables["matches"]
            seeds["matches"] = set(db.scalars(select(match.c.id).where(match.c.candidate_id == row["candidate_id"], match.c.job_id == row["job_id"])))

    plan = build_plan(db, [], actor, seeds=seeds, preserve=preserve)
    # Explicit staff deletion is deliberately not available through bulk seed plans.
    if action == "delete" and resource == "users":
        plan = build_plan(db, [], actor, user_id=key)
    # Matches are linked to candidate/job pairs, not application IDs. Include that logical edge.
    match_table = Base.metadata.tables["matches"]
    extra_matches = set()
    for app in db.scalars(select(Application).where(Application.id.in_(plan["ids"].get("applications", [])))):
        extra_matches.update(db.scalars(select(match_table.c.id).where(match_table.c.candidate_id == app.candidate_id, match_table.c.job_id == app.job_id)))
    if extra_matches:
        merged = {name: set(ids) for name, ids in plan["ids"].items()}
        merged.setdefault("matches", set()).update(extra_matches)
        expanded = build_plan(db, [], actor, seeds=merged, preserve=preserve)
        # Explicit single staff deletion was already authorized by build_plan above.
        expanded["ids"]["users"] = plan["ids"].get("users", [])
        expanded["ids"] = {name: ids for name, ids in expanded["ids"].items() if ids}
        expanded["counts"] = {name: len(ids) for name, ids in expanded["ids"].items()}
        plan = expanded
    for resume in db.scalars(select(Resume).where(Resume.id.in_(plan["ids"].get("candidate_resumes", [])))):
        candidate_id = db.scalar(select(User.candidate_id).where(User.id == resume.user_id))
        if candidate_id and candidate_id not in plan["ids"].get("candidates", []):
            updates.append(("candidates", candidate_id))
    for match in db.execute(select(match_table).where(match_table.c.id.in_(plan["ids"].get("matches", [])))).mappings():
        updates.extend(("applications", i) for i in db.scalars(select(Application.id).where(Application.candidate_id == match["candidate_id"], Application.job_id == match["job_id"], Application.id.not_in(plan["ids"].get("applications", [])))))
    updates = sorted(set(updates))
    if action in ("test_reset", "test_ai") or selection.test_only:
        unsafe = {name: [i for i in ids if labels.get(f"{name}:{i}") not in ("TEST", "DEMO")]
                  for name, ids in plan["ids"].items()}
        unsafe = {name: ids for name, ids in unsafe.items() if ids}
        for name, identifier in updates:
            if labels.get(f"{name}:{identifier}") not in ("TEST", "DEMO"):
                unsafe.setdefault(name, []).append(identifier)
        if unsafe or plan["detach"]:
            raise HTTPException(409, {"message": "Test cleanup would affect unmarked REAL records. Nothing was changed.", "blocked_records": unsafe,
                                      "detached_memberships": plan["detach"]})
    plan["updates"] = updates
    plan["counts"] = {f"delete:{name}": count for name, count in plan["counts"].items()}
    for name, _ in updates:
        plan["counts"][f"update:{name}"] = plan["counts"].get(f"update:{name}", 0) + 1
    if action == "registrations":
        plan["counts"]["update:registration_policy"] = 1
    state = []
    for name, ids in {**plan["ids"]}.items():
        table = Base.metadata.tables[name]
        pk = next(iter(table.primary_key.columns))
        state.extend(dict(row) for row in db.execute(select(table).where(pk.in_(ids)).order_by(pk)).mappings())
    for name, identifier in updates:
        table = Base.metadata.tables[name]
        pk = next(iter(table.primary_key.columns))
        state.append(dict(db.execute(select(table).where(pk == identifier)).mappings().one()))
    plan["digest"] = hashlib.sha256(json.dumps([plan["digest"], state, labels, selection.model_dump()], default=str, sort_keys=True).encode()).hexdigest()
    plan["bytes"] = sum(len(row.get("content", b"")) for row in state if isinstance(row.get("content"), bytes))
    return plan


def integrity_report(db):
    issues = []
    for table in Base.metadata.sorted_tables:
        for fk in table.foreign_keys:
            count = db.scalar(select(func.count()).select_from(table).where(fk.parent.is_not(None),
                                ~select(fk.column).where(fk.column == fk.parent).exists()))
            if count:
                issues.append({"table": table.name, "field": fk.parent.name, "orphans": count})
    messages = Base.metadata.tables["messages"]
    missing_jobs = db.scalar(select(func.count()).select_from(messages).where(messages.c.job_id.is_not(None),
        ~select(Job.id).where(Job.id == messages.c.job_id).exists()))
    if missing_jobs:
        issues.append({"table": "messages", "field": "job_id (legacy logical link)", "orphans": missing_jobs})
    stale = db.scalar(select(func.count()).select_from(Application).join(Job, Job.id == Application.job_id)
        .where(Application.assessment.is_not(None), Application.assessment["job_revision"].as_integer() != func.coalesce(Job.revision, 1)))
    return {"foreign_key_orphans": issues, "stale_assessments": stale,
            "resume_storage": "Database binary rows; deleting a resume removes its uploaded bytes in the same transaction.",
            "unattributed_ai": "Historical telemetry/cache entries lack ownership metadata and are never included automatically in test-only cleanup."}
