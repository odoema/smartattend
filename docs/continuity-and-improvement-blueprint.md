# SmartAttend: Continuity and Improvement Blueprint

**Purpose:** Give a future maintainer enough context to operate, protect, and improve SmartAttend if the current owner is unavailable or cannot continue maintaining it.

**Status:** Working handover draft, 22 October 2026. This documents the repository and deployment state observed during the recent audit. It is not proof that every user workflow has been tested.

**Implementation note:** The local working checkout contains an unreleased draft of the race-safe attendance change, login throttling, migration, clearer device-verification wording, and regression scenarios. The Edge Function TypeScript check, browser-script parse, and `git diff --check` pass. The database migration workflow could not run because Docker Desktop is unavailable; the admin-only end-to-end attendance test has not been run against a test deployment. Nothing has been committed, deployed, or verified against a real attendance flow. Apply the new database migration before deploying the API change.

## 1. Product purpose

SmartAttend is an attendance-management system for an academic institution. Its intended controls combine student/account eligibility, course/session and timetable state, a registered device credential, user verification, and location checks before recording attendance. It records attendance outcomes and refusals for later review. Kampala (Africa/Kampala) is the authoritative timezone for displayed institutional times.

Use the repository README and the original project/business canvas as the product authorities. Do not infer attendance policy, pricing, institutional ownership, or business commitments from implementation details alone.

## 2. Source of truth and current deployment

- **Repository:** `https://github.com/odoema/smartattend`; treat its `main` branch as the code source of truth.
- **Current public site:** `https://smartattend.live/`, published from the repository's `web/` directory through GitHub Pages.
- **Legacy host:** `https://mba-smartattend.netlify.app/` was the earlier host. Do not treat it as the production deployment unless the owner explicitly reactivates it.
- **Backend:** Supabase project reference `gbyvlotgjrtrnogtbemi`; Edge Function `smartattend-api`.
- **Deployment automation:** inspect `.github/workflows/` before changing deployment. The audited `Verify` and `Deploy API to Supabase` checks succeeded for commit `f6476de`.
- **Recent recovery:** `web/app.js` was restored from known-good commit `ec37c619` and the displayed time formatting was changed to Kampala. Commit `f6476de` corrected the ping endpoint to return UTC so the client does not apply Kampala offset twice.
- **Working-copy warning:** `C:\Users\odoem\Downloads\MBA_ATTENDANCE\smartattend-repo\smartattend` was an unpacked, stale copy without `.git`; its README still described Netlify. Do not use that copy as the deploy source or overwrite it blindly. Clone the GitHub repository and compare any local-only work first.

The production clock and API ping were checked after the fix. The audit did **not** authenticate as a student or exercise a complete attendance lifecycle; do not describe those workflows as live-verified.

## 3. System outline

The browser application lives in `web/`. It calls the Supabase Edge Function in `supabase/functions/smartattend-api/`, which performs application-level authentication and policy checks and accesses the database. SQL schema and policies are in `supabase/migrations/`. GitHub Actions verify and deploy parts of the system.

Expected attendance decision path, as reflected by the code and README:

1. Establish the user's account and role; reject ineligible or unrecognized accounts.
2. Confirm the requested class/session and timetable are valid at the current Kampala institutional time.
3. Require the enrolled device credential and user verification where the flow requires it.
4. Evaluate location and attendance rules on the server; do not trust a browser-only success state.
5. Persist the attendance result and relevant refusal/audit information; return a clear result to the user.

This is a logical overview, not a substitute for tracing the specific endpoint before changing its behavior.

## 4. Simpler product approach that still meets the canvas goals

The canvas outcomes do not require a complicated biometric platform or special-purpose hardware. A focused web application can replace paper registers, make proxy attendance harder, let lecturers control sessions, and produce dependable reports by combining the institution's roster and timetable with short, server-validated attendance sessions and a registered passkey/device credential.

### Target experience

- **Institution setup:** an authorized administrator imports or maintains students, lecturers, courses, enrollments, and timetable data. Provide a guided checklist and clear validation errors rather than asking non-technical staff to configure database-like settings.
- **Lecturer:** show today's scheduled classes, one clear “Open attendance” action, the current session status and a live count, then one clear “Close attendance” action. Allow a deliberate exception path for schedule changes, with the reason recorded.
- **Student:** show the active class and one clear check-in action. Confirm eligibility, session state, timetable window, registered credential/user verification, duplicate status, and any institution-approved location rule on the server. Return a plain-language success or specific next step.
- **After class:** provide an authorized attendance list, corrections/exception review, and a simple export/report. Make checkout configurable to the approved attendance policy rather than requiring extra interaction by default.
- **Recovery:** provide a documented process for a lost/replaced phone or unavailable passkey, with identity review and an audit trail; never let support staff silently impersonate a student.

### Use layered checks, not a single magic proof

Use account/enrollment checks to answer “is this person eligible for this class?”, a WebAuthn credential with user verification to answer “was an enrolled device credential used?”, a time-limited server-side session to answer “is attendance open now?”, and optional institution-configured location checks to answer “is the device reporting an acceptable location?”. Each addresses a different risk. A rotating session QR or short code can help students find the right session, but is only a convenience/binding signal: it can be shared and must not be treated as proof of physical presence. GPS can be inaccurate or spoofed; document the residual risk and use proportionate policy rather than promising perfect fraud prevention.

Prefer existing phones and browsers over fingerprint readers, kiosks, or custom hardware. WebAuthn/passkeys can use the device's supported local verification, but SmartAttend should neither collect raw biometrics nor claim that every verification was a fingerprint. Add a QR/code only if pilot evidence shows it reduces wrong-class check-ins or improves usability; it should not replace enrollment, session, or server-side checks.

### Keep implementation small and auditable

1. Make the server authoritative for identity-to-enrollment authorization, session state, attendance windows, duplicate prevention, and the final write.
2. Keep policies explicit and institution-configurable where needed (location requirement, check-in window, checkout, correction process); avoid hidden heuristics and unexplained automated rejection.
3. Build accessible, mobile-first screens with ordinary language, visible status, and a recovery path. Test with actual students, lecturers, and non-technical administrators.
4. Start with one institutional pilot and measure completion time, errors/false rejections, lecturer effort, reporting effort, and support volume before adding features.
5. Treat AI as an implementation aid for prototyping, tests, documentation, and code review—not as the authority for attendance decisions, institutional policy, security approval, or production release. A human maintainer and institution remain accountable.

## 5. External research and design choices

Research checked 22 October 2026. Public repositories and model cards are examples to inspect, not security certifications or proof that their performance claims generalize to SmartAttend's students, devices, campus, or policies.

- **Rotating QR as a session-finding and freshness control:** the public [`SanduCC/qr-attendance` repository](https://github.com/SanduCC/qr-attendance) documents a mobile web/PWA flow with short-lived rotating QR tokens, one check-in per account/device/session, server-side role checks, rate limiting, and a manual lecturer correction path. These are useful patterns to evaluate against SmartAttend's existing session workflow. Its page showed 0 stars at review, and this review did not independently audit or run it; borrow the ideas only after checking code, license, threat model, and tests. A rotating code reduces the useful lifetime of a screenshot; it does not stop someone sharing a live code or prove physical presence.
- **Passkeys/WebAuthn for the registered-device proof:** the [W3C WebAuthn specification](https://www.w3.org/TR/webauthn-3/) describes scoped public-key credentials used for strong web authentication. Keep the current credential approach rather than adding face matching solely because a canvas uses the word biometric. Supabase's current [passkey guide](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/auth/passkeys.mdx) describes its passkey API as experimental; do not migrate SmartAttend's authentication to it without a separate compatibility, account-recovery, domain/RP-ID, and rollout review.
- **Reference implementations, not copy-paste production auth:** [SimpleWebAuthn's example](https://github.com/MasterKale/SimpleWebAuthn/blob/master/example/index.ts) demonstrates registration/authentication ceremonies, challenge handling, and credential verification. It explicitly uses in-memory example data and a demo session setup; production code must use durable challenge state, secure session storage, strong secrets, correct origin/RP validation, replay protection, and maintained dependencies.
- **Face-recognition/anti-spoofing models:** the [Hugging Face Medoc Face Auth Space](https://huggingface.co/spaces/nav9v/medoc-face-auth) describes a webcam/USB-camera pipeline and publishes latency and spoof-detection figures. These are project-reported metrics, not an independent evaluation on SmartAttend's intended population or devices; the Space was sleeping at review. It adds camera capture, biometric templates, liveness failure cases, accessibility and demographic evaluation, security operations, and consent/retention obligations. Do not put this in the production attendance path absent a demonstrated need, institutional approval, a lawful privacy design, independent bias/attack testing, and a tested non-biometric alternative.
- **Model and code licensing:** a Hugging Face [model inventory and license review](https://huggingface.co/yakhyo/uniface-weights) documents face model weights with non-commercial-only restrictions, GPL-derived weights, and some weights with no clear license. A permissive code license does not automatically grant commercial rights to its pretrained weights or training data. Before adopting any model, record licenses for code, weights, and training data separately and get legal review where unclear.

**Recommended selection:** keep deterministic authorization and attendance rules in the existing server/database; use WebAuthn/passkeys for device-bound authentication; make rotating QR an optional, measured session-entry aid; keep location an explicit institution policy with a disclosed limitation; provide lecturer-reviewed, auditable exceptions. Avoid facial recognition for now. This is simpler, cheaper to operate, and easier to test and explain than an ML decision pipeline, while covering the canvas outcomes.

## 6. Technical implementation blueprint

This plan improves the current Supabase Edge Function + PostgreSQL + static web application. It deliberately keeps the existing stack and product flows. The API already has `attend.options` / `attend.verify`, session state transitions, a primary key on `(session_id, student_id)` in `attendance`, WebAuthn challenge/device tables, admin-only `selftest` and `e2e.run` actions, and a 25-step end-to-end scenario described in the README. Extend these assets; do not replace them with a new framework or an ML attendance engine.

### A. Define invariants before changing code

Treat these as testable rules, enforced by the server/database rather than UI state:

1. Only an active, enrolled student can create attendance for that course/session.
2. Attendance is accepted only during an open session and its policy-defined window, using server time. Persist instants as `timestamptz` in UTC; render user-facing dates in `Africa/Kampala`.
3. A student has at most one check-in per session. The existing composite primary key is the final duplicate guard; duplicate retries return a stable “already recorded” result rather than a second mark.
4. A verified WebAuthn assertion is fresh, intended for this user/session/mode, signed for the enrolled credential and allowed RP/origin, and consumed once. User-verification means the authenticator verified locally; do not assert that the server saw a fingerprint.
5. Session close/finalize, device revoke/reset, enrollment removal, and check-in must serialize or revalidate at the write boundary. A check that passed before one of those changes must not authorize a later write.
6. Location policy is explicit (`required` or `not required` for a session/course). Save only the minimum location/accuracy evidence needed to explain the decision and disclose that GPS can be wrong or spoofed.
7. Every lecturer/admin correction or manual exception records the actor, time, target, and reason. Ordinary students cannot edit attendance or elevate roles.

### B. Make check-in a single-use, race-safe operation

Refactor `checkVerify` in `supabase/functions/smartattend-api/index.ts` into a small, auditable sequence:

1. Parse and validate request shape and bearer identity; cap body size and reject malformed coordinates/modes early.
2. Load the stored WebAuthn challenge, credential, and candidate session. Verify signature, challenge, origin/RP ID, and user verification with the existing library. Do not write attendance based solely on client-returned `checks` or client time.
3. In one short database transaction, lock the session row (`SELECT ... FOR UPDATE`) and re-check status/window, student enrollment, device still active, and the applicable location rule using the current DB state. `session.close`, `session.finalise`, `device.reset`, and enrollment changes must take compatible locks or conditional updates so the ordering is deterministic.
4. Consume the exact challenge once with a conditional `DELETE ... WHERE user_id = ? AND purpose = 'attend' AND challenge = ? AND created_at > ... RETURNING ...`; if no row is returned, reject as expired/replayed. Bind challenge context to session and check-in/check-out mode.
5. Update any WebAuthn credential state according to the authenticator counter semantics supported by the installed library, and insert/update the attendance row in that same transaction. Preserve the database uniqueness guard and handle conflict as an idempotent response.
6. Commit before returning success. Write refusal records with stable reason codes (for example `SESSION_CLOSED`, `NOT_ENROLLED`, `LOCATION_OUTSIDE_POLICY`, `CHALLENGE_REPLAYED`); do not expose stack traces or sensitive credential data to the browser.

Keep cryptographic verification outside the transaction if possible to avoid holding locks while doing CPU work, then revalidate all mutable authorization facts under lock inside the transaction. Ensure challenge consumption and attendance persistence are atomic with respect to replay and state change. Add concurrency tests before release.

### C. Harden account and device lifecycle

- Add database-backed rate limits for login and public account creation using HMAC-hashed normalized identifiers and trusted request-source data. Use atomic upserts/time buckets, generic failure text, bounded retention, and monitoring; do not store raw IPs just to rate-limit. Confirm which forwarded-IP headers Supabase guarantees before trusting them.
- Raise signup password standards consistently across signup, reset-link, and reset-code routes; use the existing password hash implementation and test migration compatibility. Avoid account-enumeration differences in recovery responses.
- Review the current 30-day bearer token and `localStorage` storage. Prefer short-lived access tokens with rotation/revocation and secure browser storage compatible with the static-site architecture. Roll out with dual validation/forced reauthentication plan and test logout, expiry, device changes, and reset behavior.
- Define device recovery before relaxing the current one-active-device constraint. A robust version can support a user-enrolled second credential or an authorized recovery process with lecturer/admin approval, rate limits, notifications, revocation, and an immutable audit event. Never let an admin see or use a student's private key.
- Keep roles assigned server-side. Treat first-admin bootstrap, lecturer codes, and account reset codes as secrets: rotate, rate-limit, minimize their lifetime, and never put their values in source, logs, this blueprint, or UI analytics.

### D. Make schedules and lecturer actions understandable

- Keep session state as the existing finite state machine `open → checkout → closed`; validate transitions with conditional updates (`WHERE status = expected_previous_state`) and return conflict responses for stale clicks.
- Use UTC instants for `opened_at`, `ends_at`, and attendance marks. Interpret recurring `slots.weekday/start_time/end_time` in `Africa/Kampala` explicitly; calculate the current schedule window on the server and test midnight/date boundaries and term start.
- Make `session.open` default from the approved timetable and show the exact course, room, local start/end, and location requirement before one-click confirmation. Keep an explicit, reasoned “unscheduled/make-up class” path so legitimate changes do not require falsifying the schedule.
- Make check-in feedback actionable: “Session not open yet,” “You are not on this course roster,” “Location could not be confirmed—try again outside / ask the lecturer,” rather than exposing internal error text. Keep lecturer-visible override and correction controls separated from normal student actions.
- Include an accessible fallback for low battery, no compatible passkey, broken GPS, or poor connectivity: lecturer verifies the person, records a marked manual entry and reason, and the report distinguishes it from cryptographically verified check-in. Never silently queue a client timestamp as authoritative attendance.

### E. Use the existing test lab as the quality engine

The repository already exposes admin-only self-test and full-cycle actions, including simulated demo data and scenarios for check-in/out, refusals, exports, and make-up sessions. Keep destructive/demo operations confined to `is_demo` records and assert that cleanup cannot touch real rows. Do not run destructive tests on production student data.

Create three CI layers:

1. **Fast unit tests:** timezone conversion; timetable boundaries; state transition rules; distance/accuracy policy; stable error codes; rate-limit bucket behavior.
2. **Database/API integration tests:** migrations on a clean Postgres; role/enrollment checks; WebAuthn fixture verification; duplicate/idempotent request; challenge expiry/replay; session-close vs check-in race; revoke vs check-in race; reset/expiry; audit event creation; report totals.
3. **Browser acceptance tests in staging:** student and lecturer journeys on mobile viewport; keyboard/screen-reader labels; passkey-supported browser plus documented fallback; real Kampala-local clock display; opened/closed session and manual exception. Use synthetic records and a deployment-specific test tenant.

Make checks blocking before production deploy. Run the existing demo end-to-end scenario automatically against a seeded isolated database or staging project, not by calling privileged `e2e.run` against production. Keep a separate post-deploy smoke test for public assets and UTC ping; it is not attendance-flow verification.

### F. Add explainable operational intelligence

“Smart” should first mean the software anticipates errors and explains decisions. Add read-only lecturer/admin indicators for repeated failed check-ins, duplicate attempts, unusual check-in bursts, sessions exceeding expected enrollment, and location-accuracy problems. Use deterministic thresholds with a reason and link to the underlying events. Label them “review” signals—not fraud findings—and never auto-mark a student absent, accuse them of cheating, or change a grade from an anomaly score.

After collecting pilot feedback, an optional AI assistant can summarize a class report or answer constrained questions over already-authorized aggregate data. It must not receive raw biometrics, passwords, reset codes, or unnecessary location history; it must obey the caller's role, cite the records/filters it used, and require human confirmation before any write. Defer this until permission checks, audit trails, retention, and a safe test set exist. A rules-based dashboard delivers most of the value at lower cost and with reproducible behavior.

### G. Rollout gates

- **Gate 1 — Correctness:** concurrency fix, login limits, test coverage, no secrets in logs, and green migration/integration checks.
- **Gate 2 — Usability:** observed trial with representative students, lecturers, and administrators; measure median check-in completion, failure/retry rate, lecturer time, and support requests.
- **Gate 3 — Pilot:** one course or department, documented attendance policy, named support owner, verified backup/restore, and manual fallback.
- **Gate 4 — Expansion:** only after pilot success thresholds are met and the institution approves data retention, location use, exception handling, and operating cost.

Do not add face matching or continuous location collection as a shortcut through any gate.

## 7. Audit findings and prioritized roadmap

### P0 — Continuity and recovery

- Ensure at least two trusted maintainers can access the GitHub organization/repository, Pages settings, Supabase project, and required deployment credentials. Store recovery codes and credentials in an organization-approved password manager, never in this document or the repository.
- Confirm billing/ownership and account recovery paths for GitHub and Supabase; document who can authorize changes and deployments.
- Keep the canonical source in Git. Migrate useful work from the unpacked Downloads copy by diffing files, not by copying the whole folder over `main`.
- Establish and periodically test database backups and a restore procedure. Record backup retention and who can perform a restore after confirming the actual Supabase plan/settings.
- Add a concise incident contact and decision-making procedure once the owner supplies the appropriate people and details.

### P1 — Authentication and authorization hardening

- Add server-side login throttling by account and network source, with progressive delay, safe error messages, and monitoring. The audited login path did not show app-level throttling.
- Review password policy and reset flows. The observed signup minimum was six characters; choose a stronger policy compatible with the user population and existing password hashing/auth flow.
- Review the 30-day token lifetime and browser `localStorage` storage. Consider shorter sessions, rotation/revocation, and a recovery path; test impact on attendance devices before changing.
- Preserve server-side role/ownership checks, WebAuthn user verification, and the rule that the browser cannot grant attendance or administrative privileges by itself.
- Review first-admin provisioning and lecturer/admin-code handling without exposing codes in logs, source, or this document.

### P2 — Attendance integrity and concurrency

- Close the narrow time-of-check/time-of-use window: the audit found that `checkVerify` prechecks and final database writes are not one atomic state transition. Re-check session state, enrollment/device validity, and applicable constraints at the write boundary, ideally in a transaction or conditional database operation.
- Add concurrency tests for session close/revoke occurring while a check-in is in progress, duplicate submissions, and retries after network timeouts.
- Document location assumptions and residual GPS spoofing risk. Location is a signal, not strong proof of physical presence; assess proportionate mitigations with the institution rather than silently broadening collection.

### P3 — Tests and operational observability

- Add automated tests for UTC timestamps versus Kampala display time, daylight/timezone formatting behavior, timetable boundaries, late/early windows, and date rollover.
- Add API tests for role and enrollment eligibility, session state, device verification, location rejection, duplicate attendance, and refusal logging.
- Extend smoke checks beyond asset loading and ping. Use a non-production/test environment and synthetic accounts for login and end-to-end attendance; never use real student records as test fixtures.
- Monitor deploy failures, API errors, authentication abuse, and unexpected attendance/refusal rates. Define alert ownership and avoid logging passwords, tokens, WebAuthn secrets, or unnecessary location detail.
- The existing smoke workflow was not evidence of a full sign-in or attendance test; CI success alone is not workflow acceptance.

### P4 — Database maintenance and performance

- Review the database advisor findings: five foreign keys lacked supporting indexes (`attempts.student_id`, `excusals.excused_by`, `excusals.student_id`, `feedback.user_id`, `sessions.opened_by`); three indexes were reported unused (`slots_weekday_idx`, `password_reset_tokens_expiry_idx`, `feedback_created_at_idx`). Confirm workload and query plans before adding or removing indexes.
- Consider retention/cleanup rules for attempts, password reset tokens, feedback, and attendance-related records only after institutional, legal, and operational requirements are established.
- Keep RLS and grants under review. The audit saw RLS enabled with no policies on some tables; that appeared intentional because direct public/anonymous/authenticated table access was revoked and access occurs through the backend. Verify grants and function access together before changing policies.

## 8. Safe change and release procedure

1. Start from a fresh clone of `odoema/smartattend`; confirm `git status` is clean and identify the active branch and current commit.
2. Read the relevant README, workflow, API handler, and migrations. Search for related client and server behavior; do not make a frontend-only change to a server-enforced rule.
3. Make a focused branch/change and add a regression test. Never put credentials, student data, admin codes, or production tokens into Git.
4. Run the repository's documented checks and inspect GitHub Actions. Follow the actual workflow rather than assuming that a local command deploys.
5. Review the diff for accidental truncation or broad replacement, especially `web/app.js` and the API entrypoint.
6. Deploy through the approved GitHub Pages and Supabase workflows. Apply database migrations only after reviewing their order and production impact; do not edit an already-applied migration as if it had never run.
7. Verify the published page, asset response, API ping/time semantics, and relevant end-to-end workflow in a safe test account. Record which checks were performed and which were not.
8. For rollback, use a reviewed `git revert` and redeploy through the normal workflow. For schema changes, use a forward corrective migration and a tested backup/restore plan; reverting application code alone may not reverse database state.

Before any release, check the live site hostname and deployment commit. Netlify is historical, not an alternate production confirmation.

## 9. Security and privacy guardrails

- Do not commit or paste secrets into issues, chat, documentation, logs, or screenshots. Rotate a secret if it is exposed; deleting the visible copy is not sufficient.
- Keep database access server-side and least-privilege. Treat RLS policies, grants, Edge Function authorization, and service-role credentials as one security boundary.
- Minimize student personal data and location precision/retention. Define access, retention, correction, and deletion rules with the institution and applicable requirements before changing them.
- WebAuthn uses public-key credentials; do not collect or store raw biometric data. Do not represent a device credential or GPS result as infallible proof of identity or attendance.
- Never test destructive operations or attendance policy changes against real student records without authorization and a recovery plan.

## 10. Business canvas and product implications

The supplied document, *Business Canvas Model Smart Student Attendance System*, describes an institutional attendance product intended to replace paper registers, reduce proxy signing, let lecturers control attendance sessions, and automate attendance reporting. Its proposed customers include colleges and universities, academic departments, lecturers, administrators, and students. It proposes self-service registration, institutional ICT and academic channels, training/support, and revenues from subscriptions, annual licences, implementation, maintenance, and customization. These are the canvas author's business hypotheses, not confirmed contracts, pricing, or current revenue.

The canvas identifies colleges/universities, ICT departments, lecturers/academic units, GPS/location providers, and cloud/database providers as partners. Its key activities include developing the service, registering users and courses, managing sessions, verifying device/location, recording check-in/out, and reporting. Its listed resources are the app, student/lecturer and attendance databases, timetable data, device verification, GPS/geofencing, and a development/ICT team. Its cost assumptions include development, hosting/storage, location services, cybersecurity, support/training, updates, and staffing. Validate each proposed partner, resource, cost, channel, and revenue stream with the owner and intended institution before using it for procurement or product commitments.

### Important distinction: biometric claim

The canvas says students are uniquely identified through biometrics such as fingerprint/thumbprint and uses wording that can imply the system itself performs biometric identification. The current implementation uses WebAuthn/passkey-style device credentials and user verification; this does **not** mean SmartAttend receives or stores a fingerprint, nor does it independently prove that the platform's user-verification prompt was a biometric rather than another supported device method. Product copy, privacy notices, and sales materials should accurately describe device-credential verification, and avoid promising biometric identity proof unless the implementation and threat model are explicitly changed and reviewed.

### Translate the canvas into a product plan

1. **Validate the buyer and operator:** identify the institution that owns the service, the budget holder, the data controller, technical operator, and support contact. Student and lecturer users are not necessarily the paying customer.
2. **Turn value claims into pilot measures:** measure attendance completion time, lecturer reporting effort, duplicate/proxy attempts detected, false rejection rate, availability, and user support burden. Set baseline and success thresholds with the institution before a pilot.
3. **Agree the attendance policy:** define opening/closing windows, late rules, make-up classes, location boundaries, device replacement/recovery, exceptions, appeals, and record correction. Encode only approved rules.
4. **Design for institutional onboarding:** validate identity/enrollment imports, timetable ownership, role assignment, training, accessibility, and support workflows with ICT and academic staff.
5. **Test the financial model:** price hosting, development, support, security, training, integrations, and continuity against a named funding or licensing model. Subscription, annual licence, setup, maintenance, and customization are candidate streams from the canvas, not current confirmed revenue.
6. **Set privacy and governance terms:** agree collection, access, retention, correction/deletion, location precision, and reporting authorization before expanding deployment.
7. **Run a bounded pilot:** use one consenting institution or course, documented rollback and support, non-production test accounts, and published acceptance criteria before broad rollout.

Keep the supplied canvas as the origin/context document. Maintain a separate decision log for validated assumptions, rejected assumptions, and decisions made with institutional stakeholders; update this technical blueprint when those decisions materially change the system.

## 11. Handover checklist

- [ ] Two maintainers can recover GitHub and Supabase access.
- [ ] A current database backup exists and restore has been tested.
- [ ] Production domains, DNS, Pages settings, and Supabase project ownership are documented in the team's secure system.
- [ ] The original Business Model Canvas and institutional attendance policies are stored alongside the project records; canvas assumptions have named validation owners.
- [ ] Product claims about biometrics accurately reflect WebAuthn user verification and do not imply biometric data is collected or stored.
- [ ] A pilot buyer, measurable success criteria, support owner, and funding/continuity model are identified.
- [ ] Login throttling and password policy have an owner and implementation plan.
- [ ] Attendance state changes are protected against concurrency and have regression tests.
- [ ] Kampala time and full attendance lifecycle tests run in CI or a controlled staging environment.
- [ ] A maintainer has verified a rollback and incident communication procedure.

## 12. Key code locations

- `README.md` — product overview and current setup/deployment context.
- `web/app.js` — browser application and time display.
- `supabase/functions/smartattend-api/index.ts` — API, authentication, and attendance decision logic.
- `supabase/migrations/` — database schema and access-control changes.
- `.github/workflows/` — verification and deployment automation.

**Last audited:** 22 October 2026. Re-check repository, workflow, hosting, and Supabase state before relying on operational details; deployments and account configuration can change independently of this document.
