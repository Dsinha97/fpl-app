---
name: signed-in
description: Put the preview browser into the signed-in state (or back to signed-out) using the dev-only test account, so signed-in-only UI and RLS can actually be looked at. Use when asked to "test signed in", "check the signed-in state", "sign in as the test user", or before shipping anything that renders differently with a session.
---

# Signed-in state

Every signed-in verification in this repo used to be the owner signing in by hand. That cost us
the `health_check` RLS bug (granted `to anon` only — the home page broke *only* for signed-in
users), and `CLAUDE.md` records the lesson three separate times. This skill is the mechanism.

**Test both states.** A pass done only signed-out hides anon-only RLS policies; a pass done only
signed-in hides the `router.replace()`-in-render warning on the branch a page redirects *from*.

## The test account

| | |
|---|---|
| Email | `test@fpldecision.com` (Cloudflare Email Routing alias → the owner's Gmail) |
| Supabase user id | `6254e573-8cea-402c-b330-b2a8f3cae5d7` |
| Claimed manager | `user_profiles.entry_id = 274486` — so `/team`, `/leagues`, `/deadline` render real data |
| Credentials | `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` in `.env.local` (gitignored via `.env*`) |
| Storage key | `sb-fyxyqxpscmqjyjxsyhms-auth-token` in `localStorage` — auth-js default, `lib/supabase/client.ts` never sets `storageKey` |

It is a **fixture**, seeded with ad hoc `execute_sql`, deliberately **not** a migration — a row
carrying a password hash must never ride a deploy into shared history. Re-seed with `seed.sql`
in this directory if it is ever deleted.

The password exists only to mint a session through the API. The app itself has **no password
sign-in** — `app/signin/page.tsx` offers Google OAuth and `signInWithOtp` only. Never type it
into a form; there is no form to type it into.

That user id is also the `{{OTHER_USER_ID}}` the `verify-rls` skill asks for and cannot mint.

## Sign in (fast path — no email, no quota)

Start the preview (`preview_start` with `fpl-app-dev`), then run this with `javascript_tool`
from the app's own origin:

```js
const URL_ = "https://fyxyqxpscmqjyjxsyhms.supabase.co";
const KEY = "sb_publishable_EyX73kWWpruC-B_QZbcZ9A_Ax6a1OKx"; // NEXT_PUBLIC_, ships in the bundle
const res = await fetch(URL_ + "/auth/v1/token?grant_type=password", {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: KEY },
  body: JSON.stringify({ email: "test@fpldecision.com", password: "<TEST_USER_PASSWORD>" })
});
const session = await res.json();
if (!session.access_token) throw new Error("no token: " + JSON.stringify(session));
localStorage.setItem("sb-fyxyqxpscmqjyjxsyhms-auth-token", JSON.stringify(session));
```

The token response *is* the session object auth-js persists — no reshaping needed. Then navigate
(don't just reload) and `AuthProvider` picks it up through `onAuthStateChange`; `autoRefreshToken`
keeps it alive for the session.

## Sign out

```js
localStorage.removeItem("sb-fyxyqxpscmqjyjxsyhms-auth-token");
```

then navigate. Or click **Sign out** in the account menu, which exercises the real
`supabase.auth.signOut()` path.

## Sign in (real path — validates the flow itself)

Use this when the change touches sign-in, not for routine testing: the magic link shares one
**project-wide hourly email quota** (`friendlyAuthError` special-cases `over_email_send_rate_limit`).

1. `/signin/` → enter `test@fpldecision.com` → send link.
2. Read it out of the owner's Gmail via the Gmail connector (the Cloudflare alias forwards there).
3. **Check the host before opening it** — expect `fyxyqxpscmqjyjxsyhms.supabase.co` or
   `fpldecision.com`. Then navigate the preview browser to it.
4. The callback is a client route; PKCE is exchanged by `detectSessionInUrl`.

Two things bite here, both verified 2026-09-13:

- **The preview browser refuses to navigate to `supabase.co`**, so the `/auth/v1/verify` hop can't
  be driven from the pane. Resolve the 303 with `curl -o /dev/null -w '%{redirect_url}'` and
  navigate the tab to the resulting `localhost:3000/auth/callback/?code=…` instead — same origin,
  and the PKCE verifier is already in that tab's `localStorage`.
- **The token is single-use and something consumes it in transit** (mail-provider link scanning),
  so the first attempt came back `otp_expired`. Treat a first-try failure as expected, not as a
  broken flow.
- Requesting the link with a bare `POST /auth/v1/otp` ignores `options.email_redirect_to` and
  falls back to the project's Site URL (`https://fpldecision.com`) with a non-PKCE token. Request
  it **through the `/signin/` form** if you want a localhost callback.

## Confirming it took

- Account menu: initials `DS`, team name `DS United`, `test@fpldecision.com`, **Sign out**.
  "Not signed in" means the injection didn't land.
- `/` redirects to `/deadline/` when signed in.
- `/settings/` shows four tabs; signed out it is a sign-in wall except `?tab=status`.
- An edge function returns anything **other than 401** — that proves `verifyUser` accepted the JWT.

## Routes that differ signed-in vs signed-out

`/` (redirects away) · `/team` (FPL refresh, rivals, manager claim) · `/leagues` (profile entry id
vs `localStorage` fallback) · `/settings` (sign-in wall → four tabs) · `/deadline` · `/signin`
(redirects) · `account-menu` · `sync-health` · `telegram-link` · draft cloud sync
(`draft-sync-provider`) · every `functions/v1/*` call.
