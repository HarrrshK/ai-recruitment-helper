"""Bootstrap a trusted administrator: python -m app.manage_admin EMAIL."""
import argparse
import getpass
from sqlalchemy import select
from pydantic import EmailStr, TypeAdapter
from app.auth import hash_password
from app.db import SessionLocal, init_db
from app.models import User
from app.services.audit import record


def main():
    parser = argparse.ArgumentParser(description="Trusted operator administrator bootstrap")
    parser.add_argument("email")
    parser.add_argument("--password", help="Password for administrator account (min 6 characters)", default=None)
    args = parser.parse_args()
    email = str(TypeAdapter(EmailStr).validate_python(args.email)).lower()
    init_db()
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        
        password = args.password
        if not password and not user:
            password = getpass.getpass("New administrator password (6+ characters): ")
        elif not password and user:
            choice = input(f"User '{email}' already exists. Reset password? (y/N): ").strip().lower()
            if choice == "y":
                password = getpass.getpass("New administrator password (6+ characters): ")

        if password:
            if len(password) < 6:
                parser.error("Password must be at least 6 characters")
            pw_hash = hash_password(password)
            if not user:
                user = User(email=email, full_name="Administrator", password_hash=pw_hash)
                db.add(user)
                db.flush()
            else:
                user.password_hash = pw_hash

        if not user:
            parser.error("Failed to find or create user")

        user.role, user.disabled = "superadmin", False
        user.token_version = (user.token_version or 0) + 1
        record(db, user, "admin.bootstrap", user.id)
        db.commit()
        print(f"Administrator successfully enabled for '{email}' with SuperAdmin access! Sign in at /login.")


if __name__ == "__main__":
    main()
