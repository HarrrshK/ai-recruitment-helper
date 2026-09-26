from functools import lru_cache
from pathlib import Path

_DIR = Path(__file__).parent


def load_prompt(name: str) -> str:
    """Read app/prompts/<name>.md (one prompt file per agent)."""
    from sqlalchemy import select
    from sqlalchemy.exc import OperationalError
    from app.db import SessionLocal
    from app.models import PromptVersion
    if name not in {p.stem for p in _DIR.glob("*.md")}:
        raise ValueError("Unknown prompt")
    try:
        with SessionLocal() as db:
            active = db.scalar(select(PromptVersion).where(PromptVersion.name == name).order_by(PromptVersion.id.desc()).limit(1))
            if active:
                return active.content
    except OperationalError:
        pass  # Files remain usable before the first database initialization.
    return (_DIR / f"{name}.md").read_text(encoding="utf-8").strip()
