"""Isolated browser-test API: real persistence/auth, deterministic assessment fixtures."""
import os
from types import SimpleNamespace

if not os.environ.get("DATABASE_URL", "").startswith("sqlite:////tmp/"):
    raise RuntimeError("The browser fixture requires an explicit SQLite database under /tmp")

from app.agents.resume_parser import ParsedProfile
from app.agents.interviewer import Question
from app.db import SessionLocal, init_db
from app.main import app
from app.models import Job
from app.routers import portal, recruiter


def parsed_resume(text, llm):
    return ParsedProfile(name="Alex Morgan", skills=["Python", "SQL", "Docker"], total_years_experience=5)


def assessment(**kwargs):
    return SimpleNamespace(
        overall_score=81, breakdown={"skills": 90, "semantic": 80, "experience": 80, "ai_review": 75},
        summary="Your Python and SQL experience aligns well with the backend role. More evidence of distributed systems would strengthen your match.",
        strengths=["Demonstrated Python development", "Five years of relevant engineering experience"],
        gaps=["Limited evidence of distributed systems"],
        evidence=[SimpleNamespace(model_dump=lambda: {"claim": "Python delivery experience", "quote": "Built Python APIs and SQL data pipelines for five years."})],
        skill_details=[SimpleNamespace(skill="Python", kind="must", status="demonstrated"), SimpleNamespace(skill="SQL", kind="must", status="demonstrated"), SimpleNamespace(skill="Kubernetes", kind="nice", status="missing")],
        review_scores={"skills_score": 85, "domain_fit_score": 60, "experience_score": 80}, confidence=0.85, dropped_quotes=0,
    )


portal.parse_resume = parsed_resume
portal.match_candidate = assessment
recruiter.parse_resume = parsed_resume
recruiter.generate_questions = lambda **kwargs: [
    Question(id=0, text="How would you design a reliable Python API?", competency="technical", difficulty="medium", good_answer_signals=["Discusses validation and failure handling", "Explains testing and monitoring"]),
    Question(id=1, text="Describe how you diagnosed a production incident.", competency="problem_solving", difficulty="medium", good_answer_signals=["Uses evidence to isolate the cause"]),
    Question(id=2, text="How do you collaborate when a teammate disagrees?", competency="behavioural", difficulty="easy", good_answer_signals=["Communicates tradeoffs respectfully"]),
    Question(id=3, text="What would you prioritise in your first month in this role?", competency="role_fit", difficulty="medium", good_answer_signals=["Connects priorities to job requirements"]),
]
init_db()
with SessionLocal() as db:
    if not db.get(Job, 1):
        for title in ("Backend Engineer", "Data Platform Engineer", "Engineering Intern"):
            db.add(Job(title=title, status="ready", brief="Build reliable services and data products with a collaborative engineering team.", description={"markdown": "## The role\nBuild reliable Python services and help shape our data platform.\n\n## Responsibilities\n- Design and maintain APIs\n- Collaborate with product teams\n- Improve service reliability", "requirements": {"must_have_skills": ["Python", "SQL"], "nice_to_have_skills": ["Docker", "Kubernetes"], "min_years_experience": 2, "responsibilities": ["Build APIs"]}}))
        db.commit()
