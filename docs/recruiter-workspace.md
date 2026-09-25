# Recruiter Workspace

Recruiter sessions use `/recruiter/dashboard`, with jobs, applicants, interviews, messages and company profile sections. Registration opens company setup. Legacy frontend routes redirect into the new workspace.

## Ownership

New recruiter registrations create independent companies. Recruiter APIs enforce company ownership for jobs, applications, resumes, messages and interviews. Startup migrates existing unassigned recruiters and jobs into one legacy company. Global legacy recruiter APIs are disabled when another company exists, preventing cross-company access through older endpoints.

## Hiring Workflow

Jobs support drafts, publishing, editing and closing. Publishing requires a company name and job description. Closing removes the job from public browsing without deleting applications.

Applicant review uses the exact submitted resume. Assessments persist evidence, score components and explanations. Rankings are per job, exclude rejected and withdrawn applications, and use current saved assessments. Changes to a job description or requirements mark earlier assessments stale until reassessed.

Shortlisting, rejection and interview progress update candidate-visible application history. Interview rounds store schedules, generated questions and structured feedback. Internal ratings, notes and answer indicators remain recruiter-only. Only explicitly shared feedback is returned to candidates. AI failures remain retryable without deleting the application or interview.

## Verification

`backend/tests/test_recruiter_workspace.py` covers ownership, lifecycle, ranking, migration and interview privacy. The browser check uses real authentication and persistence with deterministic AI fixtures:

```sh
# From backend
DATABASE_URL=sqlite:////tmp/hr-recruiter-browser.db .venv/bin/python -m uvicorn tests.portal_browser_server:app --host 127.0.0.1 --port 8002
# From frontend, with the frontend development server running
TEST_BASE_URL=http://127.0.0.1:3001 TEST_API_URL=http://127.0.0.1:8002 node scripts/check-recruiter-workspace.mjs
```

This browser fixture does not call a live AI provider or modify the normal application database.
