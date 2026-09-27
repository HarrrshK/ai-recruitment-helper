# Account security and candidate privacy

New accounts receive a stable `public_id` UUID. Candidates can see it in their profile; developer user management can search by it; authorized recruiter application records receive the same ID for support and matching. It is an identifier, not an authentication secret.

Candidate profile sharing is opt-in by field for email, phone, headline, location, current position, biography, and skills. The candidate's name and the resume and cover letter submitted with an application remain visible to that hiring team as application materials. Profile visibility changes are enforced by the recruiter application-detail API, not just hidden in the browser.

Candidate job screening parses the selected resume and compares extracted skills to structured requirements on open jobs. The percentage is an explainable skill-coverage estimate, not the full application assessment or a hiring decision. Candidate cohort ranking returns only the candidate's own rank and assessed group size; it never returns another candidate's identity, resume, profile, or score.

## Password recovery

Configure outbound SMTP in the backend environment before enabling recovery links:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=mailer@example.com
SMTP_PASSWORD=replace-with-provider-password
SMTP_FROM=AI Recruiter <mailer@example.com>
SMTP_USE_TLS=true
FRONTEND_BASE_URL=https://recruit.example.com
```

Recovery links are random, stored only as a SHA-256 digest, expire after one hour, are single-use, and invalidate the account's other sessions after a successful reset. Requests are capped at three per account per hour. The request response does not disclose whether an email address has an account. Until SMTP is configured, the request endpoint returns a configuration error rather than pretending a message was sent.

The optional “Keep me signed in for 30 days” choice stores that browser's bearer token in local storage and requests a 30-day token expiry. Without it, the session is limited to the current browser tab and uses the standard seven-day token expiry.
