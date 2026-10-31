# SmartAttend™ — Smart Student Attendance Management System

**Live demonstration:** https://smartattend.live  
**Developer & IP Owner:** **Brian Odoch Emmanuel**  
**Copyright:** © 2026 Brian Odoch Emmanuel. All rights reserved.

SmartAttend is a secure, mobile-first attendance management system designed to reduce proxy attendance and improve the reliability of class registers.

> **Proprietary software.** The public demonstration is for product demonstration only. Source-code ownership remains with Brian Odoch Emmanuel. See [`LICENSE.md`](LICENSE.md) and [`OWNERSHIP.md`](OWNERSHIP.md).

## How attendance is verified

Before attendance is recorded, the system applies multiple checks:

| Check | Purpose |
|---|---|
| **Account** | Confirms that the student is signed in and enrolled on the course. |
| **Session** | Confirms that the lecturer has opened the class and that the requested action is valid for the current class state. |
| **Timetable** | Confirms that the request falls within the permitted attendance window. |
| **Registered device** | Uses a WebAuthn/passkey credential registered to the student's phone. |
| **Location** | Uses the phone's GPS and the configured classroom/venue rules. |
| **User verification** | Uses the device's fingerprint, face or screen-lock verification through WebAuthn. |
| **Audit trail** | Records refused attempts so that lecturers and administrators can review them. |

The system combines these controls rather than relying on a single attendance signal.

## Core business rules

- A class follows the configured timetable and lecturer-controlled lifecycle.
- Attendance windows include the configured early check-in and post-class checkout periods.
- A student cannot be enrolled in two groups for the same course unit.
- New passwords meet the configured minimum length.
- Sign-in and account-creation activity is rate limited.
- Venue/location rules can be configured for courses.
- Demo/test activity is isolated from normal attendance activity.

## Technology

- **Frontend:** HTML, CSS and JavaScript
- **Backend:** Supabase Edge Function API
- **Database:** PostgreSQL through Supabase
- **Device verification:** WebAuthn/passkeys
- **Automation:** GitHub Actions
- **Reporting:** Web dashboard, Excel export and print/PDF reporting
- **Hosting:** Current public demonstration is served through the existing deployment arrangement.

## Product capabilities

- Student, lecturer and administrator roles
- Course and class management
- Timetable-aware attendance
- Device registration and WebAuthn verification
- GPS/venue verification
- Live attendance registers
- Blocked-attempt reporting
- Excel and print reports
- Demo/test laboratory
- Password recovery and reset-code recovery
- Feedback and help facilities
- Business-model reporting

## Security position

SmartAttend is proprietary software. Production credentials and other secrets are not intended to be stored in source control. Sensitive database objects are protected through the application's server-side access model and database controls.

Security hardening follows the principle **Protect Without Breaking**: the working attendance, authentication, reporting and deployment behaviour is treated as a known-good baseline. High-risk security changes are not performed blindly in production.

See:

- [`LICENSE.md`](LICENSE.md) — proprietary software terms
- [`OWNERSHIP.md`](OWNERSHIP.md) — ownership and intellectual-property statement
- [`SECURITY.md`](SECURITY.md) — security policy
- [`docs/SECURITY_HARDENING_BASELINE.md`](docs/SECURITY_HARDENING_BASELINE.md) — controlled hardening approach

## Public demonstration and private source

The public demonstration exists so users, institutions and potential clients can evaluate SmartAttend. It does **not** grant a licence to copy, modify, redistribute or commercialise the implementation.

The long-term protected architecture is:

**Private source repository → controlled deployment → public demonstration surface**

The current working demonstration should not be disrupted while this separation is being implemented and verified.

## Operational note

Production configuration, credentials, access codes, deployment tokens, database connection details and other private operational information are intentionally excluded from this public README.

## Contact

For licensing, implementation, institutional deployment, custom development, support or partnership enquiries, contact **Brian Odoch Emmanuel** through his authorised business contact channels.

---

**SMARTATTEND™ — Developed & Owned by Brian Odoch Emmanuel — © 2026 — All Rights Reserved**
