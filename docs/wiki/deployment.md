# Deployment

Static Next.js export, served by Cloudflare Workers static assets — no server at runtime.

## Shape

`next.config.ts` sets `output: "export"` and `trailingSlash: true`, deliberately **no `basePath`**.
Cloudflare's Git integration builds `main` (`npm run build`, Node from `.nvmrc`) and `wrangler
deploy` serves `out/` per `wrangler.jsonc`. `.github/workflows/ci.yml` still typechecks/lints/builds
as a quality gate but no longer deploys.

## Three landmines from the GitHub Pages → Cloudflare migration, worth not rediscovering

- **Base path was silently correct by accident, not by design.** It was derived from
  `GITHUB_REPOSITORY` whenever `GITHUB_ACTIONS` was set. Cloudflare sets neither, so it resolved to
  `""` — but any future build running inside Actions would have silently prefixed every asset with
  `/fpl-app`, producing a page whose HTML parses and whose scripts all 404. Removed outright rather
  than left as a latent trap.
- **`trailingSlash: true` pairs with Cloudflare's `html_handling: "auto-trailing-slash"` default** —
  resolves both `/team` and `/team/` to `out/team/index.html`. Setting that Cloudflare option to
  `"none"` would 404 every route.
- **`NEXT_PUBLIC_*` are Cloudflare *Build* variables, not runtime bindings.** A static export has no
  runtime; the values are baked in at build time. `lib/supabase/client.ts` calls `createClient` at
  module scope, so a missing key throws `supabaseUrl is required` during prerender and fails the
  build outright — this is not a "works but degraded" failure mode, it's a hard build break.

## Custom domain

`fpldecision.com` is the canonical host (Sprint 25), registered through Cloudflare Registrar so
the zone was already in the same account as the Worker. Apex is canonical, declared as a
`custom_domain` route in `wrangler.jsonc` rather than left as dashboard-only state.
`www.fpldecision.com` is a Cloudflare Redirect Rule (301, preserving the path/query) to the
apex — **not** a `custom_domain`/Worker route. Registering both hosts as `custom_domain` was
tried first and reverted: it makes the Worker serve `www` directly (its own `200`) instead of
redirecting it, which is the opposite of "canonical apex." The redirect rule can't be expressed
in `wrangler.jsonc`; it's dashboard-only, same as the domain attachment itself. It needs a
proxied DNS record to exist before it can fire — `www.fpldecision.com` is an `A` record pointed
at `192.0.2.1` (a documentation/discard address; irrelevant since the proxy intercepts and
redirects before any origin fetch happens). Plain `http://` is also 301'd to `https://` via
**Always Use HTTPS** (SSL/TLS → Edge Certificates), a Cloudflare toggle rather than a second
redirect rule.

The original `fpl-app.deepayansinha.workers.dev` URL keeps resolving — Cloudflare has no clean
way to turn it off for a Git-integration Worker — so it stays a live fallback even though it's no
longer linked from any doc, and stays in the Supabase Auth redirect allowlist alongside the new
domain rather than being removed.

## What static export means for the codebase

No server components fetching at request time, no route handlers, no `next/image` optimisation.
Every page loads its own data from Postgres directly in the browser over the publishable key — see
[data-pipeline.md](data-pipeline.md) for why that's safe (every write path is a service-role Edge
Function, never reachable from the client bundle). This shape is also what rules several generic
web-performance recommendations out — see [performance.md](performance.md) for the measured
baseline and which of a third-party optimization playbook's ideas actually apply here.

## Privacy note

The repository is private; **the deployed site is not** — both `fpldecision.com` and the original
Workers URL are open to anyone holding them, and Postgres RLS (see
[database-and-rls.md](database-and-rls.md)) is the only real access boundary. Gating with
Cloudflare Access is a recorded, not-yet-built follow-up — if enabled, preview deployments need
gating too, since they get their own public URLs.

## CI/hosting housekeeping worth knowing about

- **CSP** is set in `public/_headers` (`connect-src` for Supabase and Cloudflare Web Analytics'
  reporting endpoint, `img-src` for the FPL/flag/crest hosts, `script-src` additionally allowing
  Cloudflare's analytics beacon (Sprint 25, opted in deliberately — was previously CSP-blocked, a
  safe default that also meant nothing was being collected), `'unsafe-inline'` script/style — a
  nonce needs a server this hosting shape doesn't have).
  The file's own comment used to call these "Cloudflare Pages header rules" although this project
  deploys via Workers static assets, not Pages — corrected 2026-08-22; Workers static assets reads
  `_headers` with the same convention Pages does, confirmed by the live site's response headers.
- **HTML `Cache-Control` is now explicit** (`public, max-age=0, must-revalidate`) rather than left to
  the platform default — the live default already matched (confirmed via `curl -I` against the
  deployed Worker before making it explicit), so this guards against a future default change rather
  than changing current behaviour. `/_next/static/*` keeps its separate one-year immutable rule,
  since Next content-hashes those filenames and HTML does not. See
  [design-audit-response.md](../sprints/design-audit-response.md).
- **Actions minutes are metered** on a private repo (unlike public repos, which were unlimited) —
  `deploy.yml` was deleted since Cloudflare's own Git integration handles deploys, roughly halving
  per-push consumption.
## Supabase Edge Functions: a second deploy surface with its own rules

Cloudflare serves the static front end; the functions deploy separately, and that half has bitten
harder.

### Deployment ordering is not advisory

The Class A cron gate has one real failure mode: **if a function starts requiring a header before
`invoke_sync` sends it, every scheduled sync 401s — silently, into `sync_runs` rows nobody is
watching.** So the order is fixed, and step 2 before step 3 is the part that matters:

1. Create the Vault secret, generated in place so nobody ever holds it.
2. Apply the migrations — after this, cron sends a header the deployed functions still ignore.
   **That harmless middle state is the whole point of doing it second.**
3. Deploy the functions, Class A first then Class B.
4. **Verify against `sync_runs` before walking away.** `sync-live-gameweek` runs every 2 minutes and
   is the fastest signal; a wall of `error` rows carrying a 401 means step 3 landed before step 2.

Rollback reverses 3 then 2, for the same reason. The same ordering governed Sprint 36's `notify`
rollout, where the cron schedule was deliberately split into its own migration applied *after* the
function existed — scheduling first points pg_cron at a 404 it retries into a gap nobody reads.

**The positive case is not a curl.** Nobody holds the cron secret by design, so the proof that cron
still works is the cron tick itself — a `success` row from a real scheduled run. That is stronger
evidence anyway: a curl with a hand-copied header proves only that the comparison works, not that
`invoke_sync` sends what the function expects.

### The CLI, and why the MCP path is not equivalent

Deploys through the Supabase MCP integration take file **contents** as arguments, so every byte of a
function plus its shared dependencies is retyped on the way in — ~35 KB per function, and
`generate-predictions` alone carries 70 KB of model code where one silently-mistyped coefficient
would corrupt predictions in a way nothing here would catch. That is why Sprint 32's deploy stalled
at 2 of 10 functions.

The blocker turned out to be smaller than recorded: the CLI is installed locally and **only
`supabase login` needs a human**. Two wrinkles worth not rediscovering:

- `npx supabase login` fails from PowerShell with a `PSSecurityException` on the `npx.ps1` shim
  (execution policy). `npx.cmd supabase login` bypasses it, as does Git Bash.
- The automatic flow refuses to run in a non-TTY environment at all
  (`LegacyLoginMissingTokenError`), so it must be a real terminal regardless of shell.

**One real regression was caught by the gate and fixed the same pass**, and it is a structural blind
spot rather than an accident: `sync-manager` came up `503 BOOT_ERROR` because `index.ts` imported
`int` from `_shared/fpl.ts`, which does not export it. `tsc` cannot catch this —
`supabase/functions/**` is excluded from tsconfig and eslint by necessity. Every other
function/shared import was swept for the same class of error; this was the only one.

### One CLI deploy reconciles four drifts

As of 2026-09-10 the repo and the deployed project disagree in four places, all fixed by one
command (`supabase functions deploy sync-news generate-predictions notify telegram-webhook` from a
linked CLI):

- `config.toml` claims `verify_jwt = true` for `sync-news` and `generate-predictions`; the project
  still has `false`. **A config file is only a claim until a deploy applies it** — the exact failure
  that file was written to prevent.
- `notify` and `telegram-webhook` were uploaded through the integration with their `_shared/`
  dependencies **inlined and comments trimmed**, so behaviour is identical but the deployed source
  is not byte-identical to this repo.

It is deliberately deferred rather than forgotten: the invocation cost the `verify_jwt` flip saves
is near-zero while the repo is private and nobody knows the function URLs, and becomes real the
moment it is public. See
[edge-function-security.md](edge-function-security.md#verify_jwt-measured-rather-than-assumed).
