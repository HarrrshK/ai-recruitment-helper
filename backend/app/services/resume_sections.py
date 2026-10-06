"""Find verbatim resume sections without inventing missing qualifications."""
import re

HEADINGS = {
    "education": "education", "academic background": "education", "qualifications": "education",
    "projects": "projects", "personal projects": "projects", "selected projects": "projects", "academic projects": "projects",
    "experience": "experience", "work experience": "experience", "professional experience": "experience", "employment history": "experience",
    "skills": "other", "technical skills": "other", "summary": "other", "professional summary": "other",
    "certifications": "other", "awards": "other", "languages": "other", "interests": "other", "references": "other",
}


def resume_sections(text: str) -> dict[str, list[str]]:
    sections = {"education": [], "projects": [], "experience": []}
    active = None
    lines = []

    def flush():
        if active in sections and lines:
            value = "\n".join(lines).strip()
            if value:
                sections[active].append(value)

    for line in text.splitlines():
        heading = re.sub(r"^[#*\s]+|[:*\s]+$", "", line).casefold()
        if heading in HEADINGS:
            flush()
            active = HEADINGS[heading]
            lines = []
        else:
            lines.append(line)
    flush()
    return sections
