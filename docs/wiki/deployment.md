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
Function, never reachable from the client bundle).

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
