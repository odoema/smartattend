# SmartAttend — Smart Student Attendance Management System (MVP)

A working attendance system. Before a student's attendance is recorded, the server checks:

| Check | How it works |
|---|---|
| **Account** | Student signs in. Their account must be enrolled on the course (they join with the lecturer's 6-letter code). |
| **Session** | The lecturer has opened the class. Check-in works only while it's open, and check-out only after the lecturer ends the class. |
| **Timetable** | Kampala time must fall inside the course's timetabled slot (check-in opens 15 min early; check-out allowed up to 30 min after the slot ends). A lecturer can open a make-up class outside the timetable. |
| **Registered device** | Each account is bound to one phone through a WebAuthn passkey that lives on that phone. Another phone can't produce the signature. |
| **Location** | The phone's GPS must be within the classroom radius. The centre is the lecturer's position when they start the class (or the saved venue location). Fixes weaker than ±150 m are refused. |
| **Biometric** | The phone's fingerprint, face or screen lock must confirm the user (WebAuthn user verification). The server checks the cryptographic signature. |

Every refused attempt is logged and shown to the lecturer live and in reports.

## Folders

- `web/` — the website (plain HTML/CSS/JS, no build step). `config.js` holds the API address.
- `supabase/migrations/0001_smartattend.sql` — database schema (private `smartattend` schema, RLS on, not exposed to the public API).
- `supabase/functions/smartattend-api/index.ts` — the single API (Supabase Edge Function, deploy with JWT verification **off**; it does its own sign-in).

## Working from GitHub

Pushing to `main` deploys automatically:

| You change | What happens |
|---|---|
| anything in `web/` | GitHub Pages republishes https://odoema.github.io/smartattend/ (`.github/workflows/pages.yml`) |
| `supabase/functions/smartattend-api/` | the API is redeployed to Supabase (`.github/workflows/supabase-function.yml`, needs the `SUPABASE_ACCESS_TOKEN` repository secret) |

Database changes (`supabase/migrations/`) are applied by hand in the Supabase SQL editor.

## Deploy the website (Netlify, free)

1. Go to https://app.netlify.com/drop and sign in.
2. Drag the **web** folder onto the page.
3. Netlify gives you a link like `https://something.netlify.app`. Rename it under *Site configuration → Change site name* (e.g. `smartattend-ug`).
4. Open the link on a phone. Location and fingerprint need https, which Netlify provides.

## Move the backend to another Supabase project

1. In the new project, open **SQL Editor**, paste `supabase/migrations/0001_smartattend.sql` and run it.
2. Deploy `supabase/functions/smartattend-api` as an Edge Function named `smartattend-api` with **Verify JWT turned off**.
3. Change the address in `web/config.js` to `https://<project-ref>.supabase.co/functions/v1/smartattend-api` and redeploy the web folder.
4. Read the access codes: `select * from smartattend.settings;`

## First-time setup

1. **Admin:** on the sign-in page tap *Create an admin account* and enter the admin access code.
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

## Notes and limits of this MVP

- If a student changes phones, the lecturer (Students tab) or the admin resets the phone, and the student registers the new one.
- Phones need a fingerprint, face or screen lock set up. Chrome on Android 9+ and Safari on iOS 16+ are supported.
- GPS can be faked on rooted phones. Combining it with the per-phone passkey, the fingerprint and the lecturer-controlled session makes proxying impractical, but not impossible.
- For a production rollout, set *Allowed website addresses* in the admin page to the site's exact address.
