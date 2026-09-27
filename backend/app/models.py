from datetime import UTC, datetime
import secrets
from uuid import uuid4

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

STAGES = ("applied", "screened", "interview", "offer", "rejected")


def _now() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(String(36), unique=True, index=True, default=lambda: str(uuid4()))
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(200), default="")
    role: Mapped[str] = mapped_column(String(20), default="recruiter")  # recruiter | candidate
    candidate_id: Mapped[int | None] = mapped_column(ForeignKey("candidates.id"), default=None)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id"), default=None)
    permissions: Mapped[list | None] = mapped_column(JSON, default=None)
    disabled: Mapped[bool | None] = mapped_column(Boolean, default=False)
    token_version: Mapped[int | None] = mapped_column(Integer, default=0)
    session_key: Mapped[str | None] = mapped_column(String(64), default=lambda: secrets.token_hex(24))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    brief: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[dict | None] = mapped_column(JSON, default=None)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id"), default=None)
    creator_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), default=None, index=True)
    revision: Mapped[int | None] = mapped_column(Integer, default=1)
    location: Mapped[str | None] = mapped_column(String(200), default="")
    work_mode: Mapped[str | None] = mapped_column(String(30), default="onsite")
    employment_type: Mapped[str | None] = mapped_column(String(30), default="full_time")
    matching_rules: Mapped[dict | None] = mapped_column(JSON, default=None)  # custom weights for screening
    custom_questions: Mapped[list | None] = mapped_column(JSON, default=None)  # recruiter interview questions
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    matches: Mapped[list["Match"]] = relationship(back_populates="job", cascade="all, delete-orphan")
    interviews: Mapped[list["Interview"]] = relationship(back_populates="job", cascade="all, delete-orphan")
    qa_entries: Mapped[list["QaEntry"]] = relationship(cascade="all, delete-orphan")
    # messages.job_id has no database-level foreign key (it was added to an existing table), so the join is spelled out.
    messages: Mapped[list["Message"]] = relationship(
        primaryjoin="Job.id == foreign(Message.job_id)", cascade="all, delete-orphan", viewonly=False
    )


class Candidate(Base):
    __tablename__ = "candidates"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(200), default="")
    resume_text: Mapped[str] = mapped_column(Text, default="")
    parsed_profile: Mapped[dict | None] = mapped_column(JSON, default=None)
    stage: Mapped[str] = mapped_column(String(20), default="applied")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    matches: Mapped[list["Match"]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan"
    )
    interviews: Mapped[list["Interview"]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan"
    )
    messages: Mapped[list["Message"]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan"
    )


class Match(Base):
    __tablename__ = "matches"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"))
    candidate_id: Mapped[int] = mapped_column(ForeignKey("candidates.id"))
    overall_score: Mapped[float] = mapped_column(Float, default=0.0)
    breakdown: Mapped[dict | None] = mapped_column(JSON, default=None)
    evidence: Mapped[list | None] = mapped_column(JSON, default=None)
    strengths: Mapped[list | None] = mapped_column(JSON, default=None)
    gaps: Mapped[list | None] = mapped_column(JSON, default=None)
    summary: Mapped[str] = mapped_column(Text, default="")
    skill_details: Mapped[list | None] = mapped_column(JSON, default=None)  # per-skill: demonstrated / listed / missing
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    dropped_quotes: Mapped[int] = mapped_column(Integer, default=0)  # evidence quotes rejected as not verbatim
    roadmap: Mapped[dict | None] = mapped_column(JSON, default=None)  # Skill-Gap Coach learning plan
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    job: Mapped[Job] = relationship(back_populates="matches")
    candidate: Mapped[Candidate] = relationship(back_populates="matches")
    panel_reviews: Mapped[list["PanelReview"]] = relationship(
        back_populates="match", cascade="all, delete-orphan"
    )


class PanelReview(Base):
    __tablename__ = "panel_reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"))
    persona: Mapped[str] = mapped_column(String(50))  # tech_lead | hr_manager | hiring_manager | moderator
    score: Mapped[float] = mapped_column(Float, default=0.0)
    reasoning: Mapped[str] = mapped_column(Text, default="")
    extra: Mapped[dict | None] = mapped_column(JSON, default=None)  # concerns, verdict, disagreements

    match: Mapped[Match] = relationship(back_populates="panel_reviews")


class Interview(Base):
    __tablename__ = "interviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("candidates.id"))
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"))
    transcript: Mapped[list | None] = mapped_column(JSON, default=None)
    scorecard: Mapped[dict | None] = mapped_column(JSON, default=None)
    status: Mapped[str] = mapped_column(String(20), default="in_progress")  # in_progress | completed
    questions: Mapped[list | None] = mapped_column(JSON, default=None)  # the planned questions, with answer keys
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    candidate: Mapped[Candidate] = relationship(back_populates="interviews")
    job: Mapped[Job] = relationship(back_populates="interviews")


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("candidates.id"))
    kind: Mapped[str] = mapped_column(String(20))  # invite | reject | offer
    body: Mapped[str] = mapped_column(Text, default="")
    subject: Mapped[str] = mapped_column(Text, default="")
    job_id: Mapped[int | None] = mapped_column(Integer, default=None)
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | sent (marked by the recruiter)
    extra: Mapped[dict | None] = mapped_column(JSON, default=None)  # interview details for invites
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    candidate: Mapped[Candidate] = relationship(back_populates="messages")


class QaEntry(Base):
    """One question a candidate asked about a job, and how the Q&A bot handled it."""

    __tablename__ = "qa_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"))
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text, default="")
    sources: Mapped[list | None] = mapped_column(JSON, default=None)
    escalated: Mapped[bool] = mapped_column(Boolean, default=False)  # passed to a human recruiter
    reason: Mapped[str] = mapped_column(String(60), default="")
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AgentRun(Base):
    """One row per LLM call. Powers the dashboard's agent activity timeline."""

    __tablename__ = "agent_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    agent: Mapped[str] = mapped_column(String(50))
    model: Mapped[str] = mapped_column(String(100), default="")
    input_hash: Mapped[str] = mapped_column(String(64), default="")
    output: Mapped[str] = mapped_column(Text, default="")
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    cached: Mapped[bool] = mapped_column(Boolean, default=False)
    provider: Mapped[str | None] = mapped_column(String(40), default=None)
    estimated_cost: Mapped[float | None] = mapped_column(Float, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CandidateProfile(Base):
    __tablename__ = "candidate_profiles"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    headline: Mapped[str] = mapped_column(String(200), default="")
    phone: Mapped[str] = mapped_column(String(60), default="")
    location: Mapped[str] = mapped_column(String(200), default="")
    current_position: Mapped[str] = mapped_column(String(200), default="")
    bio: Mapped[str] = mapped_column(Text, default="")
    skills: Mapped[list] = mapped_column(JSON, default=list)
    visible_fields: Mapped[list] = mapped_column(JSON, default=lambda: ["headline", "location", "current_position", "bio", "skills"])


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class Resume(Base):
    __tablename__ = "candidate_resumes"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    content: Mapped[bytes] = mapped_column(LargeBinary)
    text: Mapped[str] = mapped_column(Text)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Application(Base):
    __tablename__ = "applications"
    __table_args__ = (UniqueConstraint("user_id", "job_id", name="uq_application_user_job"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("candidates.id"), index=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"), index=True)
    resume_id: Mapped[int] = mapped_column(ForeignKey("candidate_resumes.id"))
    job_title: Mapped[str] = mapped_column(String(200))
    cover_letter: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(30), default="applied")
    history: Mapped[list] = mapped_column(JSON, default=list)
    assessment: Mapped[dict | None] = mapped_column(JSON, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ApplicationMessage(Base):
    __tablename__ = "application_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("applications.id"), index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    sender_role: Mapped[str] = mapped_column(String(20))
    sender_name: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Company(Base):
    __tablename__ = "companies"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    industry: Mapped[str] = mapped_column(String(200), default="")
    website: Mapped[str] = mapped_column(String(500), default="")
    location: Mapped[str] = mapped_column(String(200), default="")
    size: Mapped[str] = mapped_column(String(50), default="")
    about: Mapped[str] = mapped_column(Text, default="")
    contact_email: Mapped[str] = mapped_column(String(200), default="")
    legacy_workspace: Mapped[bool] = mapped_column(Boolean, default=False)
    knowledge: Mapped[str | None] = mapped_column(Text, default="")
    active: Mapped[bool | None] = mapped_column(Boolean, default=True)


class CompanyInvite(Base):
    __tablename__ = "company_invites"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    email: Mapped[str] = mapped_column(String(200))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    permissions: Mapped[list | None] = mapped_column(JSON, default=None)


class RuntimeConfig(Base):
    __tablename__ = "runtime_config"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer, default=1)


class PromptVersion(Base):
    __tablename__ = "prompt_versions"
    __table_args__ = (UniqueConstraint("name", "base_revision"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), index=True)
    base_revision: Mapped[int | None] = mapped_column(Integer, default=None)
    content: Mapped[str] = mapped_column(Text)
    author_id: Mapped[int] = mapped_column(Integer)
    note: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(100), index=True)
    target: Mapped[str] = mapped_column(String(200))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    signature: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ImpersonationSession(Base):
    __tablename__ = "impersonation_sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    actor_version: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class LLMEvent(Base):
    __tablename__ = "llm_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    agent: Mapped[str] = mapped_column(String(100))
    model: Mapped[str] = mapped_column(String(150))
    kind: Mapped[str] = mapped_column(String(50), index=True)
    detail: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class DevTask(Base):
    __tablename__ = "dev_tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(30), default="running")
    result: Mapped[dict | None] = mapped_column(JSON, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class EmbeddingEntry(Base):
    __tablename__ = "embedding_entries"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    model: Mapped[str] = mapped_column(String(150))
    vector: Mapped[list] = mapped_column(JSON)


class HiringInterview(Base):
    __tablename__ = "hiring_interviews"
    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("applications.id"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="Technical interview")
    interviewer: Mapped[str] = mapped_column(String(200), default="")
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    location: Mapped[str] = mapped_column(String(500), default="")
    status: Mapped[str] = mapped_column(String(30), default="planned")
    questions: Mapped[list | None] = mapped_column(JSON, default=None)
    feedback: Mapped[dict | None] = mapped_column(JSON, default=None)
    candidate_feedback: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
