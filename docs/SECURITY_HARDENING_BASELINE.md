# SmartAttend — Security Hardening Baseline

**Owner:** Brian Odoch Emmanuel  
**Status:** Controlled hardening — no functional redesign  
**Principle:** Protect Without Breaking

## 1. Baseline rule

Security work on SmartAttend must preserve the currently working attendance, authentication, reporting, deployment and recovery workflows unless a change is separately tested and approved.

**Audit does not automatically mean modification.**

## 2. Protected working areas

The following are treated as protected production behaviour:

- custom account authentication and session handling;
- WebAuthn/passkey device registration and verification;
- GPS and location checks;
- timetable and attendance-window rules;
- lecturer-controlled class lifecycle;
- one-group-per-course-unit enforcement;
- password recovery and reset-code recovery;
- reporting and exports;
- demo/test-lab isolation;
- the existing production Supabase project;
- the current API and database architecture; and
- the current deployment path.

## 3. Safe-first controls

The first hardening stage uses controls that do not alter application behaviour:

- formal ownership and IP documentation;
- private client-access policy;
- secret-file exclusions in `.gitignore`;
- code ownership documentation;
- public documentation sanitisation;
- read-only secret and credential review;
- dependency/security monitoring;
- backup and rollback verification; and
- separation planning for the public demo and private source.

## 4. Controlled changes

Changes to CORS, API authorisation, RLS, authentication, rate limits, password recovery, GitHub Actions, dependency versions or production configuration must first be tested against the known-good baseline.

Each controlled change should have:

1. a stated security objective;
2. an identified functional impact;
3. a test plan;
4. a rollback path;
5. verification after deployment; and
6. an owner approval record.

## 5. High-risk changes requiring separate approval

Do not perform these as routine hardening:

- replacing custom authentication;
- rewriting the RLS architecture;
- redesigning the database;
- changing attendance/GPS/WebAuthn rules;
- changing the production Supabase project;
- rewriting Git history unless a confirmed secret exposure requires it;
- replacing the deployment architecture; or
- performing a broad dependency upgrade.

## 6. Current public-source transition

The current repository remains public until the public demonstration has been separated and independently verified. The safe target architecture is:

**Private source repository → controlled deployment → public demonstration surface**

The existing working system must not be made private in a way that unexpectedly removes or interrupts the live demonstration.

## 7. Ownership mark

**SMARTATTEND™ — Developed & Owned by Brian Odoch Emmanuel — © 2026 — All Rights Reserved**
