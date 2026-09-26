"""Trusted operator commands: python -m app.manage_company --help."""
import argparse
import json
from pathlib import Path

from pydantic import EmailStr, TypeAdapter
from sqlalchemy import select

from app.db import SessionLocal, init_db
from app.models import Company, CompanyInvite, Job, User
from app.routers.recruiter import CompanyIn
from app.services.workspaces import issue_invite


def main():
    parser = argparse.ArgumentParser(description="Company administration (trusted server operators only)")
    commands = parser.add_subparsers(dest="command", required=True)
    company = commands.add_parser("save-company", help="Create or update a company from a JSON profile")
    company.add_argument("profile", type=Path)
    company.add_argument("--id", type=int)
    invite = commands.add_parser("invite", help="Create an email-bound invitation, valid for seven days")
    invite.add_argument("company_id", type=int)
    invite.add_argument("email")
    revoke = commands.add_parser("revoke-invite")
    revoke.add_argument("id", type=int)
    commands.add_parser("unassigned-jobs", help="List legacy jobs needing explicit creator assignment")
    assign = commands.add_parser("assign-job", help="Assign an unowned legacy job to its verified original creator")
    assign.add_argument("job_id", type=int)
    assign.add_argument("recruiter_email")
    args = parser.parse_args()
    init_db()
    with SessionLocal() as db:
        if args.command == "save-company":
            profile = CompanyIn.model_validate(json.loads(args.profile.read_text()))
            company = db.get(Company, args.id) if args.id else Company()
            if company is None:
                parser.error("Company not found")
            for key, value in profile.model_dump().items():
                setattr(company, key, value)
            db.add(company)
            db.commit()
            print(f"Company ID: {company.id}")
        elif args.command == "invite":
            email = str(TypeAdapter(EmailStr).validate_python(args.email))
            code = issue_invite(db, args.company_id, email)
            db.commit()
            print(f"Invitation for {email} (share privately): {code}")
        elif args.command == "revoke-invite":
            invite = db.get(CompanyInvite, args.id)
            if not invite or invite.accepted_at:
                parser.error("Unused invitation not found")
            db.delete(invite)
            db.commit()
            print("Invitation revoked")
        elif args.command == "unassigned-jobs":
            for job in db.scalars(select(Job).where(Job.creator_id.is_(None))):
                print(f"{job.id}\tcompany={job.company_id}\t{job.title}")
        elif args.command == "assign-job":
            job = db.get(Job, args.job_id)
            user = db.scalar(select(User).where(User.email == args.recruiter_email.strip().lower(), User.role == "recruiter"))
            if not job or job.creator_id is not None or not user or not user.company_id:
                parser.error("Require an unowned job and a recruiter with company membership")
            if job.company_id and job.company_id != user.company_id:
                parser.error("Job and recruiter belong to different companies")
            job.creator_id, job.company_id = user.id, user.company_id
            db.commit()
            print("Original creator assigned")


if __name__ == "__main__":
    main()
