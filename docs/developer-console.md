# Developer Console

The authenticated console lives at `/dev/llm`, `/dev/companies`, `/dev/users`,
`/dev/database`, `/dev/evaluation` and `/dev/audit`. All `/api/dev/*` endpoints
require an active developer or superadmin session. Public registration cannot
create either role, and impersonated sessions cannot access developer APIs.

## First Administrator

From `backend`, run the trusted operator command against the intended database:

```bash
.venv/bin/python -m app.manage_admin admin@example.com
```

For a new account it asks for a password, without echoing it. For an existing
account it promotes the account and revokes its old sessions. Then select
**Developer / Admin** at login. No default administrator password is installed.
Only superadmins can grant or modify developer/superadmin access. Self-modification
is blocked to prevent accidental lockout.

## Companies And Access

### Account Administration

`/dev/users` supports creation, name/email edits, role/permission edits, access
revocation, password resets, sign-out-everywhere and permanent account deletion.
Search by name/email and filter by role or access state. Developers can manage
ordinary accounts; only superadmins can create or modify staff. Self-modification
and self-deletion are blocked. Admin-created recruiters require an existing active
company and receive explicit member permissions without a public invitation flow.
Passwords set from the console require at least 12 characters and are never returned
or recorded in audit details. Password resets require the acting admin's password.

Transfer a departing recruiter's jobs to another active recruiter in the same
company before deleting their account if those jobs/applications should remain.
Otherwise deletion includes owned jobs and their dependent hiring records. Read the
preview rather than assuming deletion affects only the user row.

New accounts have an independent session key in addition to the revocation version.
An old token cannot authenticate a replacement account if a deleted database ID is
reused. Existing accounts retain their sessions through the additive migration.

### Database Danger Zone

`/dev/database` provides selectable-category cleanup, individual company/job deletion,
and **Reset all application data**. Bulk operations are superadmin-only. Every
destructive operation requires a ten-minute, signed, actor-bound preview, the exact
confirmation phrase, an administrator password, a reason and backup acknowledgement.
The backend recomputes the dependent row set under a write lock. Changed previews,
replayed tokens, active requests and running maintenance tasks block execution.
Database changes and their audit entry commit together or roll back together.

Always retained in bulk reset: developer/superadmin accounts, immutable audit history,
the maintenance setting, and server-side files/secrets. Staff company/candidate links
are detached when their referenced records are removed. Other staff accounts can be
deleted individually by a different superadmin, but never through the bulk users
category. The current account cannot be deleted. The category selector includes
jobs, applications, candidates, resumes, profiles, messages, interviews, matches,
invitations, support sessions, telemetry, embeddings, prompts, configuration and tasks.

Reset is **not a filesystem wipe**. LLM response cache files, repository prompt files,
model weights, externally exported files and database backups remain on disk. Use
the separate audited Flush cache action when appropriate. User deletion is not a
promise to erase retained audit records or unlinked historical model outputs.

No backup is created automatically. Take and verify a database backup before using
these controls; the acknowledgement is not a backup mechanism. Never use the table
inspector's redacted output as a restorable database backup.

Pause the workspace before bulk deletion. Maintenance blocks candidate/recruiter API
requests and login while staff login and developer controls remain available. Wait
for active calls/tasks to drain, execute the reviewed plan, then explicitly resume
the workspace. A persistent banner identifies the paused state across admin pages.
This interlock, like the maintenance task runner, requires a **single API process**;
it is not distributed coordination for a multi-worker deployment.

Create a company before inviting recruiters. Invitations are email-bound,
single-use, time-limited (1-30 days) and stored as hashes. The plaintext code is
shown only when generated; deliver it privately. There is no automatic email
delivery. Upload UTF-8 `company_info.md` files up to 200 KB in the company editor.

Recruiter grants are `jobs.create`, `jobs.edit`, `applicants.review`,
`interviews.manage`, `messages.send` and `company.edit`. The first five are the
default invitation grants. Only staff create companies; `company.edit` permits
an invited member to update their existing profile, not create another company.
Permissions never bypass job-creator ownership. Recruiters cannot inspect or
change coworkers' applications, even within the same company.

Role, permission and access changes invalidate existing user sessions immediately.
Suspending a company blocks its recruiter APIs and hides its published jobs.
Companies with members, jobs or invitations cannot be deleted; suspend them instead.
Support impersonation requires a reason, lasts at most 15 minutes and records
mutation requests. Return to admin restores and re-verifies the original session.
After expiry, sign in again. The target account's real data is affected by support
actions; these are not sandbox sessions.

## LLM Operations

Model routing and fallback configuration are persisted and read for each new call.
Use server-side `GROQ_API_KEY`, `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`; credentials
are never returned to the browser or stored in routing records. Ollama uses the
server-controlled `OLLAMA_BASE_URL`. Existing environment configuration remains
the default until a routing configuration is saved. Enter provider-supported
model IDs. Streaming fallback occurs only before any response text is emitted.

Prompt edits create versions in the database without overwriting repository files.
The latest version reaches subsequent agent calls. Concurrent stale edits return
409. `qa_bot.md` is an alias for this repository's `qa.md`. Playground tests use
the real configured model, bypass response caching and may incur charges.

Telemetry reports up to the latest 10,000 calls in the selected period. Cost is
an estimate using the configured blended per-million-token rate, not provider
billing. Calls without rates remain explicitly unestimated. Streaming providers
that do not return token usage cannot provide complete token/cost accounting.
Errors distinguish failures, rate limits, retries and schema validation events.

## Diagnostics And Evaluation

The database inspector is read-only and paginated. Password hashes, invite hashes,
audit signatures and raw vectors are omitted. Authorized staff can still see
sensitive recruiting records; restrict staff access accordingly.

FastEmbed vectors are cached in the SQL `embedding_entries` index and used by
the embedder. Re-indexing collects current resume, job and company-knowledge texts
and replaces the index after successful embedding. Chroma is not configured in
this repository and the UI reports that explicitly. Cache flushing removes only
JSON entries in the configured LLM cache directory.

The 127-check benchmark is a deterministic regression suite: 40 identity-redaction
checks, 40 verbatim-evidence checks and 47 pair-ranking checks. It is not a live
model quality benchmark or a replacement for human evaluation. Synthetic generation
downloads reproducible JSON fixtures; it does not insert candidates into live hiring
data or initiate a stress test automatically.

Maintenance tasks use one in-process worker. Run this release with a **single API
worker**. Interrupted tasks are marked failed on server startup and can be retried.
Use a durable external queue and distributed locking before multi-worker deployment.

## Audit And Deployment Boundaries

Administrative mutations and selected diagnostic reads create signed audit records.
ORM hooks and SQLite/PostgreSQL triggers reject audit updates and deletes. This is
application/database append-only protection, not external WORM storage: a privileged
database operator can remove triggers. Export to an independently controlled log
store for stronger retention guarantees. Maintain a stable, protected JWT signing
secret; no secrets should be committed to source control.

Back up the database before deployment. This small-scale release uses the repository's
additive schema initialization, not a full migration framework. MFA, distributed
task execution, external audit retention and production load testing remain separate
deployment work.

## Verification

```bash
# backend
DATABASE_URL=sqlite:////tmp/hr-dev-tests.db .venv/bin/pytest tests -q

# frontend, with the isolated portal_browser_server fixture on port 8002
node scripts/check-dev-console.mjs
```

The browser script only provisions accounts into an explicit `/tmp` SQLite database.
It must not be pointed at production data. Its default fixture database is
`sqlite:////tmp/hr-dev-console.db`.
