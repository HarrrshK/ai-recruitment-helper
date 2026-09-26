# Recruiter Workspace

Recruiter sessions use `/recruiter/dashboard`, with jobs, applicants, interviews, messages and a company profile that is read-only unless an administrator grants `company.edit`. Registration requires a company invitation. Existing recruiters without membership accept an invitation at `/recruiter/company`. Legacy frontend routes redirect into the new workspace. The [developer console](developer-console.md) manages companies, invitations and member permissions.

## Ownership

Recruiter APIs require both company membership and job creator ownership for jobs, applications, resumes, messages and interviews. Coworkers at the same company cannot access each other's hiring records. There is no all-company jobs view. Public careers pages expose published job descriptions, not applicant data.

Global legacy recruiter APIs are retired and return 403. Jobs predating creator tracking are not assigned automatically and remain hidden from recruiters and public careers until an administrator verifies and assigns the original creator. Existing applications and documents are retained.

## Company Administration

Company provisioning is a trusted server-operator task, not a recruiter permission. From `backend`, use:

```sh
.venv/bin/python -m app.manage_company save-company /path/to/company-profile.json
.venv/bin/python -m app.manage_company invite COMPANY_ID recruiter@example.com
.venv/bin/python -m app.manage_company unassigned-jobs
.venv/bin/python -m app.manage_company assign-job JOB_ID original-recruiter@example.com
```

The profile JSON requires `name`; optional fields are `industry`, `website`, `location`, `size`, `about` and `contact_email`. `save-company --id COMPANY_ID` updates an existing profile. Invitations are email-bound, single-use, valid for seven days, and stored only as hashes. Share the printed code privately; recruiters enter it during registration or company joining. `revoke-invite INVITE_ID` invalidates an unused invitation. No emails are sent automatically. Existing membership cannot be switched to another company with an invitation.

## Sessions

Authentication is tab-scoped in session storage. A different tab's login cannot silently change the identity used by API requests. Cached user JSON is never accepted as proof of authentication. Late responses from an old session cannot clear a newer login or restore a signed-out identity. Temporary verification failures display retry/sign-out controls.

The old persistent browser login is cleared on upgrade, requiring one fresh sign-in. The hard-coded signing secret has been removed. Set a private random `JWT_SECRET` (at least 32 characters) in deployed environments; otherwise a private key is generated at `backend/data/.jwt_secret` and persisted across restarts. Preserve that file for local sessions, never commit it, and share one configured secret across production workers/instances. Tokens signed by the old public default are invalid.

## Hiring Workflow

Jobs support drafts, publishing, editing and closing. Publishing requires a company name and job description. Closing removes the job from public browsing without deleting applications.

Applicant review uses the exact submitted resume. Assessments persist evidence, score components and explanations. Rankings are per job, exclude rejected and withdrawn applications, and use current saved assessments. Changes to a job description or requirements mark earlier assessments stale until reassessed. “Screen all candidates & rank” processes pending/stale assessments for the selected posted job (or all the current recruiter's jobs), skips closed applications and current scores, and shows progress plus individual failures. Repeating it retries remaining failures without rescoring completed results. Stop finishes the in-flight assessment; navigating away stops the remaining queue. Completed scores persist, but the queue is not a background worker.

Shortlisting, rejection and interview progress update candidate-visible application history. Interview rounds store schedules, generated questions and structured feedback. Internal ratings, notes and answer indicators remain recruiter-only. Only explicitly shared feedback is returned to candidates. AI failures remain retryable without deleting the application or interview.

## Verification

`backend/tests/test_recruiter_workspace.py` and `test_recruiter_privacy.py` cover creator isolation, lifecycle, invitations, ranking and interview privacy. Legacy business-logic unit tests explicitly override the retired endpoint dependency; current authorization tests do not. Browser checks use real authentication and persistence with deterministic AI fixtures:

```sh
# From backend
DATABASE_URL=sqlite:////tmp/hr-recruiter-privacy.db .venv/bin/python -m uvicorn tests.portal_browser_server:app --host 127.0.0.1 --port 8002
# From frontend, with the frontend development server running
TEST_BASE_URL=http://127.0.0.1:3001 TEST_API_URL=http://127.0.0.1:8002 node scripts/check-recruiter-workspace.mjs
TEST_BASE_URL=http://127.0.0.1:3001 TEST_API_URL=http://127.0.0.1:8002 node scripts/check-recruiter-privacy.mjs
```

This browser fixture does not call a live AI provider or modify the normal application database.
