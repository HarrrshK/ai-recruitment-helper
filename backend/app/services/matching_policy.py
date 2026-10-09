"""Validated job-level weights and deterministic, explicitly scoped signals."""
import math

from app.services.resume_sections import resume_sections
from app.services.skills import mentions, normalize_skill

DEFAULT_WEIGHTS = {"skills": 0.30, "semantic": 0.10, "experience": 0.20, "ai_review": 0.40,
                   "eligibility": 0.0, "projects": 0.0}


def validate_weights(value):
    if value is None:
        return None
    if not value or set(value) - set(DEFAULT_WEIGHTS):
        raise ValueError("Use the supported matching criteria")
    weights = {**DEFAULT_WEIGHTS, **value}
    if any(isinstance(v, bool) or not math.isfinite(v) or v < 0 or v > 1 for v in weights.values()):
        raise ValueError("Weights must be finite numbers between 0 and 1")
    if not math.isclose(sum(weights.values()), 1, abs_tol=0.000001):
        raise ValueError("Matching weights must total 100%")
    return weights


def additional_signals(requirements, profile, text):
    # Eligibility here is only stated required skills and years, not education or legal eligibility.
    checks = [float(any(mentions(s.casefold(), normalize_skill(skill)[0]) for s in profile.skills))
              for skill in requirements.must_have_skills]
    if requirements.min_years_experience > 0:
        checks.append(float(profile.total_years_experience >= requirements.min_years_experience))
    project_text = "\n".join(resume_sections(text)["projects"]).casefold()
    skills = requirements.must_have_skills + requirements.nice_to_have_skills
    projects = (round(100 * sum(mentions(project_text, normalize_skill(s)[0]) for s in skills) / len(skills), 1)
                if skills else None)
    return {"eligibility": round(100 * sum(checks) / len(checks), 1) if checks else None,
            "projects": projects}


def improvement_steps(assessment):
    """Component ceilings, not promises or a prediction of a future AI review."""
    actions = {
        "skills": "Build evidence for missing or weak skills in real work; describe your contribution and measurable results.",
        "experience": "Document relevant employment dates and responsibilities accurately. Experience gaps require genuine experience, not wording changes.",
        "projects": "Complete a role-relevant project and add a Projects section with the required technologies, your contribution and results.",
        "semantic": "Make relevant responsibilities and outcomes explicit in your resume, using accurate role-specific language.",
        "eligibility": "Review the stated required skills and minimum years. Address unmet requirements honestly or target roles with a lower experience requirement.",
        "ai_review": "Add verifiable examples of your skills and domain work. Explain the problem, your actions and the outcome.",
    }
    steps = []
    for key, score in assessment.get("breakdown", {}).items():
        weight = assessment.get("weights", {}).get(key, 0)
        if score is None or weight <= 0 or score >= 100:
            continue
        steps.append({"criterion": key, "action": actions.get(key, "Review the evidence for this criterion."),
                      "current_score": score, "max_additional_points": round(max(0, 100 - score) * weight, 1)})
    return sorted(steps, key=lambda step: step["max_additional_points"], reverse=True)
