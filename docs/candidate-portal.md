# Candidate Portal

The candidate workspace has five sections: jobs, applications, messages, resumes and profile.
`/candidate/dashboard` and `/apply/:jobId` redirect to the new application and job routes.
Public careers pages expose only jobs whose status is `ready`.

## Data and Access

- Profiles and resume versions belong to authenticated users.
- Applications are unique per user and job. Each references the exact resume submitted.
- Removing a resume archives it from the library; submitted applications retain that document.
- Application status is per job, with a timestamped history. The old global candidate stage is not used as an application's status.
- Assessments save score components, normalized weights, evidence, skill findings and the overall explanation. Scores are not fabricated while assessment is pending.
- Conversations are scoped to an application. Only its candidate and recruiters belonging to the job's company can read or send messages.
- Existing recruiter APIs require recruiter authentication. Public job browsing uses `/api/portal/jobs`.
- Recruiter access is company-scoped. Existing unassigned recruiters and jobs migrate together into an existing workspace; new recruiter registrations create separate companies.

The additional tables are created by the existing startup schema initialization. Existing match records are not automatically treated as applications: recruiter screening does not establish that a candidate actually applied.

## Workflow

Candidates register, complete a profile, upload one or more resumes, browse a job and submit an application. Applications are saved before assessment is requested, so an AI service failure does not discard the application. The candidate can request assessment from the Match & scores tab. The existing parser, matcher and embedding service evaluate the submitted resume. A failed request remains retryable.

The HR sidebar's Candidate messages page provides replies and per-application status updates. Candidate status history includes the HR note. Messages refresh every 15 seconds and also have a manual refresh control. Messages are stored in the application; this does not send external email.

## Local Verification

The frontend proxies `/api/*` and `/health` to `BACKEND_API_URL` (default `http://127.0.0.1:8000`). `NEXT_PUBLIC_API_URL` is optional for deployments using an externally hosted API with CORS configured.

Run API tests with `backend/.venv/bin/python -m pytest backend/tests` from the repository root with `PYTHONPATH=backend`.

For an isolated browser workflow, run from `backend`:

```sh
DATABASE_URL=sqlite:////tmp/hr-candidate-browser.db .venv/bin/python -m uvicorn tests.portal_browser_server:app --host 127.0.0.1 --port 8001
```

Then run from `frontend`:

```sh
TEST_BASE_URL=http://127.0.0.1:3001 TEST_API_URL=http://127.0.0.1:8001 node scripts/check-candidate-portal.mjs
```

The browser fixture uses real authentication, uploads, application persistence and messages, but deterministic assessment results. It does not call a live AI provider or alter the normal application database.
