import os
from collections.abc import Iterator

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def make_engine(url: str):
    if not url.startswith("sqlite"):
        return create_engine(url)
    # Screening writes from several threads. A busy timeout makes writers wait for each other instead of
    # failing with "database is locked", and WAL mode lets readers carry on while a write is in progress.
    engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(engine, "connect")
    def _enable_wal(dbapi_connection, _):
        dbapi_connection.execute("PRAGMA journal_mode=WAL")

    return engine


engine = make_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def _add_missing_columns() -> None:
    """Tiny migration step: add columns that newer models have but an older dev database lacks.

    create_all() only creates missing tables, never missing columns. Only plain nullable
    columns can be added this way, which is all this project needs.
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            existing = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name not in existing:
                    ddl_type = column.type.compile(dialect=engine.dialect)
                    conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {ddl_type}'))
        if "users" in existing_tables:
            from uuid import uuid4
            rows = conn.execute(text("SELECT id FROM users WHERE public_id IS NULL OR public_id = ''")).scalars().all()
            for user_id in rows:
                conn.execute(text("UPDATE users SET public_id = :public_id WHERE id = :id"), {"public_id": str(uuid4()), "id": user_id})
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_public_id ON users (public_id)"))


def _ensure_default_admin() -> None:
    """Auto-bootstrap a SuperAdmin user on database init if none exists."""
    from sqlalchemy import select
    from app.models import User
    from app.auth import hash_password

    admin_email = os.getenv("ADMIN_EMAIL", "helloharsh24@gmail.com").lower().strip()
    admin_password = os.getenv("ADMIN_PASSWORD", "9850harsha")

    with SessionLocal() as db:
        admin = db.scalar(select(User).where(User.role == "superadmin"))
        if not admin:
            existing = db.scalar(select(User).where(User.email == admin_email))
            if existing:
                existing.role = "superadmin"
                existing.password_hash = hash_password(admin_password)
            else:
                db.add(
                    User(
                        email=admin_email,
                        full_name="Administrator",
                        password_hash=hash_password(admin_password),
                        role="superadmin",
                    )
                )
            db.commit()


def init_db() -> None:
    from app import models  # noqa: F401  (registers tables on Base)

    Base.metadata.create_all(engine)
    _add_missing_columns()
    from app.services.audit import install_guards
    install_guards(engine)
    _ensure_default_admin()


def get_session_factory() -> sessionmaker:
    """For code that outlives the request's session (for example streaming responses)."""
    return SessionLocal


def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
