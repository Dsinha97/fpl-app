# FPL authentication — why credential login is blocked

Automated FPL login was probed and closed as genuinely impossible, not merely unbuilt — every
standards-based door is shut by FPL's own identity provider configuration, and the one reachable
flow opens with bot detection.

## The probe (2026-08-09)

FPL's identity provider is **PingOne**. Checked directly:

| Route | Result |
|---|---|
| The classic form-POST login (`users.premierleague.com/accounts/login/`) | **NXDOMAIN** — a dangling CNAME |
| OIDC `password`/ROPC grant | **Not offered at all** — nowhere to send a password |
| `authorization_code` + PKCE with a third-party redirect URI | "Redirect URI mismatch" — the client belongs to the Premier League |
| `device_code` grant | Not a supported grant type on this client |
| `response_mode=pi.flow` (no redirect URI needed) | **A live flow** — but its first node is PingOne Protect, a bot-detection signal, before any credential screen |

Automating past bot detection is out of scope regardless of whether a password exists to send —
recorded as blocked with this evidence, not worked around. **A pasted cookie authenticates nothing**
— don't re-derive this by trying again; see CLAUDE.md's ground rules.

## What was built instead — three generations, each disproven by the next

1. **§F, the session-cookie handoff** (`app/settings/fpl`, `fpl-session`/`fpl-my-team` Edge
   Functions). The signed-in owner pastes their browser's `Cookie` header; it's encrypted at rest
   (AES-256-GCM) in `fpl_sessions`, a table with **RLS enabled and zero policies** — not even the
   row's own owner can read it outside a service-role Edge Function (see
   [database-and-rls.md](database-and-rls.md)). **Disproven live**: `fpl-my-team` returned 401 every
   time. FPL no longer authenticates `/api/` calls with cookies at all — it uses a bearer token
   minted from an OIDC refresh token that lives only in browser `localStorage`, never a cookie.
2. **A server-side token exchange was considered and declined.** The refresh token **rotates on
   first exchange**, retiring the browser's own copy — a server-side exchange risks silently signing
   the owner out of their real FPL session. Declined partly on risk, and decisively because the
   payoff was zero: the owner's real `/api/my-team/` data pre-season has `purchase_price ==
   selling_price == now_cost` for all 15 picks (no price has moved yet), so the authenticated
   endpoint returns **nothing `now_cost` doesn't already give for free**.
3. **What shipped — paste the JSON, skip the credential.** The owner is already signed in, in their
   own browser; fetching `/api/my-team/{id}/`'s response there and pasting it into the app needs no
   cookie, no bearer token, no rotation risk, nothing secret held server-side.
   `teamStateFromMyTeamJson` (`lib/fpl-squad.ts`) parses it into a `TeamState` with FPL's **real**
   `purchase_price` — strictly better than `manager_picks`' `now_cost` fallback, since it also
   carries `selling_price`, bank/value, and chip availability. `sellPrice` (the one implementation,
   see [transfer-engine.md](transfer-engine.md)) is used as a **cross-check** against the pasted
   `selling_price`, never a silent override.

`fpl-session`/`fpl-my-team` stay deployed but dormant — reversible for free if a future season's
data ever makes the bearer-token route worth the rotation risk. **Do not remove them** — CLAUDE.md's
ground rules are explicit about this.

## Naming an import so it can be found again (2026-08-15)

Two constructors turn FPL data into a `TeamState` with `source: "fpl"` — `teamStateFromPicks` (this
page's §1, from `manager_picks`) and `teamStateFromMyTeamJson` (§3, from the pasted response) — and
they had drifted to two different draft-naming rules, `/team`'s own `"${team_name} (FPL)"` versus
`/settings`' bare team name. Nothing could then reliably answer "which draft is this manager's own
import?" Consolidated into `importedDraftName`/`isImportedDraftFor` (`lib/fpl-squad.ts`), the one
rule both constructors call now. `TeamState` also gained an optional `entryId`, recorded by both, so
the match survives a rename rather than depending on the name forever — see
[frontend-conventions.md](frontend-conventions.md). This is what lets `/deadline` and `/team`
default to the manager's own import instead of whichever draft is newest — see
[deadline-and-matchday.md](deadline-and-matchday.md).

## Practical gotcha this produced

The import instructions originally told users to open `/api/my-team/<id>/` directly in a new tab —
that only carries cookies, which don't authenticate anything (see above), so the instructions were
telling users to do the one thing guaranteed to 401. Fixed to walk the DevTools Network tab instead.
— [sprint-14.md §14.4](../sprints/sprint-14.md)

See also: [database-and-rls.md](database-and-rls.md) (`fpl_sessions`' zero-policy shape),
[squad-score-and-scenarios.md](squad-score-and-scenarios.md) (where an imported squad lands as a
draft).
