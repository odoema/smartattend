# SmartAttend password recovery deployment

SmartAttend currently stores its 15 application accounts in the private `smartattend.users` table and validates passwords in its own API. Supabase Auth has no corresponding SmartAttend accounts, so its built-in recovery email cannot reset these existing passwords. The new recovery endpoints keep that account model and add expiring, one-use reset links.

## Two ways to recover, and why

| Way | Needs | Who can start it |
|---|---|---|
| Emailed link | `RESEND_API_KEY` and a verified sending domain | The person themselves, from **Forgot password?** |
| 6-digit reset code | Nothing beyond the app and the database | A lecturer (their own students) or an admin, who reads the code out privately |

The code path exists because the email path fails closed in a way nobody notices: with no API key the request used to answer "check your email" and send nothing. It now answers `503` with *"Email reset is not set up yet. Ask your lecturer or the admin for a 6-digit reset code."*, and a Resend failure answers `502` in the same way. So recovery never depends on email being configured.

## Required before release (email path only)

1. In the SmartAttend Supabase project, add the Edge Function secret `RESEND_API_KEY` with a Resend API key that can send mail. Add it under **Project Settings → Edge Functions → Secrets**. Keep the key out of GitHub, source files, and chat.
2. Apply `supabase/migrations/20261020150000_password_recovery.sql` to the SmartAttend production database before deploying the updated `smartattend-api` Edge Function.
3. Deploy the updated `smartattend-api` Edge Function. The public function must continue to allow unauthenticated calls for its existing sign-in/sign-up routes and the two password recovery actions.
4. Publish the updated web app to GitHub Pages.

The email sender is `SmartAttend <support@brianodoch.com>`; the Resend account currently has `brianodoch.com` verified for sending. Reset links return to `https://smartattend.live`.

## Expected behavior

- The sign-in screen links to **Forgot password?**
- The request screen accepts the account email or student registration number and always shows a generic response to avoid revealing whether the account exists.
- Matching accounts receive a single-use link that expires after 30 minutes. Requests are throttled per identifier and source IP.
- Completing a reset updates the existing bcrypt password hash and signs the account out of all sessions.
- A missing or invalid token shows an expired-link message with a way to request another link.

## Reset codes (no email required)

- A lecturer presses **Reset code** next to a student on their course (Students tab); an admin can do the same for anyone under **People & settings**. The 6-digit code is shown once and must be read out privately.
- The person opens SmartAttend → **Have a reset code?**, enters their email or registration number, the code, and a new password (8 characters or more).
- The code is stored hashed in `smartattend.challenges`, expires after 15 minutes, works once, and every existing session is signed out when it is used.
- Guessing is throttled to 8 attempts per hour per account, counted in `smartattend.password_reset_requests` — the same table the email path uses.
- Lecturers can only issue codes for students on their own courses; only an admin can reset a lecturer or admin account.
