from collections.abc import Iterator

from pydantic import BaseModel, Field, model_validator

from app.llm.client import LLMClient
from app.prompts import load_prompt


class JobRequirements(BaseModel):
    must_have_skills: list[str] = Field(default_factory=list)
    nice_to_have_skills: list[str] = Field(default_factory=list)
    min_years_experience: int = 0
    education: str | None = None
    responsibilities: list[str] = Field(default_factory=list)
    project_expectations: list[str] = Field(default_factory=list, max_length=30)
    mandatory_requirements: list[str] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def normalize_requirements(self):
        from app.services.skills import normalize_skill
        seen = set()
        for key in ("must_have_skills", "nice_to_have_skills"):
            result = []
            for skill in getattr(self, key):
                canonical, _ = normalize_skill(skill)
                if canonical not in seen:
                    seen.add(canonical)
                    result.append(skill.strip())
            setattr(self, key, result)
        for item in self.project_expectations + self.mandatory_requirements:
            if not item.strip() or len(item) > 1000:
                raise ValueError("Requirements must contain 1-1000 characters")
        self.education = self.education.strip() if self.education and self.education.strip() else None
        return self


def stream_jd(title: str, brief: str, llm: LLMClient) -> Iterator[str]:
    """Stream a Markdown job description written from a title and short brief."""
    messages = [
        {"role": "system", "content": load_prompt("jd_generator")},
        {"role": "user", "content": f"Job title: {title}\n\nBrief:\n{brief or '(none given)'}"},
    ]
    return llm.stream(messages, agent="jd_generator", tier="large", temperature=0.5,
                      reasoning_effort="low")


def extract_requirements(markdown: str, llm: LLMClient) -> JobRequirements:
    """Turn a (possibly edited) job description into the structured requirements the Matcher uses."""
    messages = [
        {"role": "system", "content": load_prompt("jd_requirements")},
        {"role": "user", "content": markdown},
    ]
    return llm.chat_json(messages, JobRequirements, agent="jd_requirements", tier="small",
                         reasoning_effort="low")
