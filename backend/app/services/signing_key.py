import os
import secrets
import tempfile
from pathlib import Path


def signing_key(configured: str, path: Path) -> str:
    if configured:
        if len(configured) < 32 or configured == "hr-recruitment-ai-system-secret-key-2026":
            raise ValueError("JWT_SECRET must be a private random value of at least 32 characters")
        return configured
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        # Publish a fully written, owner-readable key atomically across workers.
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as temporary:
            temporary.write(secrets.token_urlsafe(48))
        try:
            try:
                os.link(temporary.name, path)
            except FileExistsError:
                pass
        finally:
            os.unlink(temporary.name)
    key = path.read_text().strip()
    if len(key) < 32:
        raise ValueError("Invalid persisted JWT signing key")
    return key
