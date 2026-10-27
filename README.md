# SmartAttend — Smart Student Attendance Management System (MVP)

**Live site:** https://smartattend.live

A working attendance system. Before a student's attendance is recorded, the server checks:

| Check | How it works |
|---|---|
| **Account** | Student signs in. Their account must be enrolled on the course (they join with the lecturer's 6-letter code). |
| **Session** | The lecturer has opened the class. Check-in works only while it's open, and check-out only after the lecturer ends the class. |
| **Timetable** | Kampala time must fall inside the course's timetabled slot (check-in opens 15 min early; check-out allowed up to 30 min after the slot ends). A lecturer can open a make-up class outside the timetable. |
| **Registered device** | Each account is bound to one phone through a WebAuthn passkey that lives on that phone. Another phone can't produce the signature. |
| **Location** | The phone's GPS must be within the classroom radius. The centre is the lecturer's position when they start the class (or the saved venue location). When a course has a saved venue location, a timetabled class can only be started within 300 m of it; make-up classes can be held anywhere. Fixes weaker than ±150 m, or with no accuracy reading at all, are refused. |
| **Biometric** | The phone's fingerprint, face or screen lock must confirm the user (WebAuthn user verification). The server checks the cryptographic signature. |

Every refused attempt is logged and shown to the lecturer live and in reports.

Other rules the server enforces:

- **Auto-close:** an open class switches to check-out 15 minutes after its timetabled end, and closes 30 minutes after.
- **One group per course unit:** a student can be on a course (e.g. MBD 7101) in Group A or Group B, not both. The website shows one group's courses at a time, the API refuses a second group, and a database trigger blocks it too.
- **Passwords:** at least 8 characters for new accounts and resets. Sign-in allows 10 tries a minute per account; new accounts are limited to 30 a minute per network.

## Folders

- `web/` — the website (plain HTML/CSS/JS, no build step). `config.js` holds the API address.
- `supabase/migrations/` — ordered database schema changes for the private `smartattend` schema: `0001_smartattend.sql`, `20261020150000_password_recovery.sql`, `20261021020000_feedback.sql`, `20261022090000_auth_rate_limits.sql`, and `20261027120000_one_group_per_course.sql`.
- `supabase/functions/smartattend-api/index.ts` — the single API (Supabase Edge Function, deploy with JWT verification **off**; it does its own sign-in).

## Working from GitHub

Pushing to `main` deploys automatically:

| You change | What happens |
|---|---|
| anything in `web/` | GitHub Pages republishes https://smartattend.live (`.github/workflows/pages.yml`), then `smoke.yml` checks the live site |
| `supabase/functions/smartattend-api/` | the API is type-checked, then redeployed to Supabase (`.github/workflows/supabase-function.yml`, needs the `SUPABASE_ACCESS_TOKEN` repository secret) |
| `supabase/migrations/` | `migrations.yml` applies every migration to a throwaway Postgres to catch errors; production is still updated by hand |

The `SUPABASE_ACCESS_TOKEN` expires on the date chosen when it was created. When it does, API deploys fail with "Invalid access token": create a new token at https://supabase.com/dashboard/account/tokens, update the secret, and re-run the failed workflow.

Database changes (`supabase/migrations/`) are applied by hand in the Supabase SQL editor. For a new project, run all migration files in filename order. For an existing project, check its migration ledger and live schema first, then apply only missing migrations; never replay a migration just because it is present in this repository. Record each production migration and its application date in the deployment log. The feedback table may have been created outside the tracked migration history, so verify its actual production state before treating the ledger as complete.

## Deploy the website elsewhere (Netlify, free)

The live site is smartattend.live on GitHub Pages; use this only for a separate copy. The old copy at mba-smartattend.netlify.app is out of date and should be taken down or redirected.

1. Go to https://app.netlify.com/drop and sign in.
2. Drag the **web** folder onto the page.
3. Netlify gives you a link like `https://something.netlify.app`. Rename it under *Site configuration → Change site name* (e.g. `smartattend-ug`).
4. Open the link on a phone. Location and fingerprint need https, which Netlify provides.

## Move the backend to another Supabase project

1. In the new project, open **SQL Editor** and run every file in `supabase/migrations/` in name order.
2. Deploy `supabase/functions/smartattend-api` as an Edge Function named `smartattend-api` with **Verify JWT turned off**.
3. Change the address in `web/config.js` to `https://<project-ref>.supabase.co/functions/v1/smartattend-api` and redeploy the web folder.
4. Read the access codes: `select * from smartattend.settings;`

## First-time setup

1. **Admin:** on the sign-in page tap *Create an admin account* and enter the admin access code. This works **once** — it creates the first admin. After that, add further admins from **People & settings → Add another admin**, and rotate the admin code there too.
2. **Lecturers:** *Create account → Lecturer*, then enter the lecturer access code (the admin can change it).
3. **Lecturer:** *New course* → code, title, venue, distance limit, timetable. Share the join code shown on the Students tab.
4. **Students:** *Create account → Student* → **Register this phone** (fingerprint) → **Join your course** with the code.
5. **In class:** the lecturer stands in the room and taps **Start class**. Students tap **Check in**. At the end the lecturer taps **End class & start check-out**, students tap **Check out**, then the lecturer taps **Finish & save register**.

## Admin dashboard, exports and testing

- **Dashboard** (admin home): totals, per-course attendance, students below 75%, recent classes, and why attempts were blocked.
- **Excel**: *Download Excel report* (admin: all courses; lecturer: own courses; per course from the Reports tab). Sheets: Summary, Students, one attendance register per course (P / P (no out) / E / A), Classes, Check-ins, Blocked attempts, Class lists, Users, Business Model Canvas.
- **Print**: *Print report* opens a landscape print layout (use *Save as PDF* to keep a copy). The Business Model Canvas page prints too.
- **Test lab** (admin → Test lab): create or remove a demo class (DEMO 101, 12 demo students, 6 past classes), simulate check-ins, check-outs and proxy attempts on the demo class only, run a system self-test, and work through a 25-step checklist covering admin, lecturer and student features.
- **Business model** (admin → Business model): the team's Business Model Canvas with live figures from the system.

## If someone forgets their password

Two ways, and neither needs the person to remember the old password:

1. **Email link** — the person taps **Forgot password?** on the sign-in screen and enters their email or registration number. This needs the `RESEND_API_KEY` secret; see `docs/password-recovery-setup.md`.
2. **Reset code** — the lecturer (course → Students tab) or the admin (People & settings) taps **Reset code**, then reads the 6-digit code out privately. The person taps **Have a reset code?** and sets a new password.

Both sign the account out of every existing session. The reset-code route needs no email provider, so recovery keeps working even when email is not configured or fails.

## Help and feedback

Every signed-in screen has a **?** in the header. It opens a Help page with the five setup steps, the usual problems (location refused, no fingerprint prompt, waiting for approval, cannot sign in) and a **feedback form**. Messages go to **People & settings → Feedback**, where an admin can mark them done.

## Notes and limits of this MVP

- If a student changes phones, the lecturer (Students tab) or the admin resets the phone, and the student registers the new one.
- Phones need a fingerprint, face or screen lock set up. Chrome on Android 9+ and Safari on iOS 16+ are supported.
- GPS can be faked on rooted phones. Combining it with the per-phone passkey, the fingerprint and the lecturer-controlled session makes proxying impractical, but not impossible.
- For a production rollout, set *Allowed website addresses* in the admin page to the site's exact address.
- Save each course's venue location (course settings) so classes can't be started away from the room.
- Upload each course's class list so only listed registration numbers are approved automatically; registration numbers are not otherwise verified.
- The home page sends a visit count (page name and referrer, no personal data) to the owner's Google Apps Script.
