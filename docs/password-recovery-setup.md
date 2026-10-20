# SmartAttend password recovery deployment

SmartAttend currently stores its 15 application accounts in the private `smartattend.users` table and validates passwords in its own API. Supabase Auth has no corresponding SmartAttend accounts, so its built-in recovery email cannot reset these existing passwords. The new recovery endpoints keep that account model and add expiring, one-use reset links.

## Required before release

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
