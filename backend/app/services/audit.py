import hashlib
import hmac
import json
from datetime import UTC, datetime

from sqlalchemy import event, text
from app.models import AuditLog


def record(db, actor, action, target, details=None):
    from app.auth import SECRET_KEY
    at = datetime.now(UTC)
    details = details or {}
    payload = json.dumps([actor.id, action, str(target), details, at.isoformat()], sort_keys=True)
    row = AuditLog(actor_id=actor.id, action=action, target=str(target), details=details, created_at=at,
                   signature=hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest())
    db.add(row)
    return row


@event.listens_for(AuditLog, "before_update")
@event.listens_for(AuditLog, "before_delete")
def immutable(*_):
    raise ValueError("Audit records are append-only")


def install_guards(engine):
    with engine.begin() as conn:
        if engine.dialect.name == "sqlite":
            for operation in ("UPDATE", "DELETE"):
                conn.execute(text(f"CREATE TRIGGER IF NOT EXISTS audit_no_{operation.lower()} BEFORE {operation} ON audit_logs BEGIN SELECT RAISE(ABORT, 'Audit records are append-only'); END"))
        elif engine.dialect.name == "postgresql":
            conn.execute(text("CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit records are append-only'; END; $$"))
            conn.execute(text("DROP TRIGGER IF EXISTS audit_immutable ON audit_logs"))
            conn.execute(text("CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation()"))
