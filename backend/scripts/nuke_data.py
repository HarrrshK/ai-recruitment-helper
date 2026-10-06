"""Nuke script: completely wipe all data (jobs, candidates, matches, interviews, users, caches).

Usage:
  python scripts/nuke_data.py
"""

import os
import shutil
import sys
from pathlib import Path

# Add backend directory to path
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

DATA_DIR = BACKEND_DIR / "data"

def nuke():
    print("🔥 Starting complete data wipe...")

    # 1. Delete SQLite database files
    for db_file in DATA_DIR.glob("*.db*"):
        try:
            db_file.unlink()
            print(f"  ✓ Deleted database file: {db_file.name}")
        except Exception as e:
            print(f"  ! Could not delete {db_file.name}: {e}")

    # 2. Clear LLM response cache
    cache_dir = DATA_DIR / "llm_cache"
    if cache_dir.exists():
        shutil.rmtree(cache_dir)
        cache_dir.mkdir(parents=True, exist_ok=True)
        print("  ✓ Cleared LLM cache directory")

    # 3. Clear uploads directory
    uploads_dir = DATA_DIR / "uploads"
    if uploads_dir.exists():
        shutil.rmtree(uploads_dir)
        uploads_dir.mkdir(parents=True, exist_ok=True)
        print("  ✓ Cleared uploads directory")

    # 4. Re-initialize database schema
    try:
        from app.db import init_db
        init_db()
        print("  ✓ Re-initialized fresh database schema")
    except Exception as e:
        print(f"  ! Database re-initialization: {e}")

    print("\n✨ Platform data has been completely nuked! The system is 100% clean.")

if __name__ == "__main__":
    nuke()
