# FPL App

Personal Fantasy Premier League analytics and decision-support application. A static Next.js front
end on Cloudflare, with Supabase Postgres and Edge Functions behind it.

Live at [fpl-app.deepayansinha.workers.dev](https://fpl-app.deepayansinha.workers.dev/).

## Docs

- [docs/roadmap.md](./docs/roadmap.md) — **the authoritative sprint plan**, reconciled against what
  is actually built, including what is blocked and why
- [docs/architecture.md](./docs/architecture.md) — data flow, schema, Edge Functions, model layer
- [docs/phase-4-model.md](./docs/phase-4-model.md) — the xP model's method, calibration and backtest
- [docs/sources/updated-plan.md](./docs/sources/updated-plan.md) — formula and method reference. Its roadmap table is
  superseded by `roadmap.md`, as is
  [docs/sources/fpl_app_phase_wise_build_plan.md](./docs/sources/fpl_app_phase_wise_build_plan.md), the original
  architecture document phases 0–4 were built from
- [docs/sources/phase-1-plan.md](./docs/sources/phase-1-plan.md) — the data-ingestion plan
- [CLAUDE.md](./CLAUDE.md) — working conventions and the gotchas that have already cost time

## What it does

An expected-points model runs in Postgres over the FPL API's data, and the front end turns it into
decisions rather than dashboards:

- **Explore** — players with xP over 1/3/5/8-gameweek horizons, fixture difficulty, risk scores, and
  a change feed of price, ownership, status and fixture movements
- **Build** — a squad optimiser and lineup/captain/bench engine over a shared `TeamState`, with a
  replacement finder for any single pick
- **Compare** — head-to-head players, and whole drafts ranked by a points-equivalent SquadScore
- **Decide** — a weekly transfer plan weighing roll against one, two, a hit, or a wildcard, which
  loads into a basket simulator that reports what the move buys after the hit

Two rules shape the numbers throughout. Where FPL zeroes a field between seasons, the term is
**dropped and the remaining weights renormalised**, with a note in the UI next to the figure — never
multiplied by zero and quietly shrunk. And a number is labelled for what it is: downgrades are called
downgrades, an assumption is shown as its own term, and an empty result set says so rather than
ranking five worse options.

## Stack

- Next.js 16 (static export) + React 19 + TypeScript + Tailwind CSS v4
- [Base UI](https://base-ui.com) for interactive primitives, shadcn/ui conventions for the rest
- Supabase (Postgres, Edge Functions, pg_cron) as the system of record
- Cloudflare Workers static assets, built from `main` by Cloudflare's Git integration

## Getting started

```bash
npm install
```

```bash
cp .env.example .env.local   # fill in your Supabase project URL + publishable key
```

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The browser only ever reads, and only over the publishable key — every write path is an Edge Function
running with the service role, so the client bundle needs no other secret.

## Commands

```bash
npx tsc --noEmit     # typecheck — run before every commit
```

```bash
npm run lint
```

```bash
npm run build        # static export to out/ — must pass before pushing
```

## Project structure

- `app/` — routes (`/` `/team` `/players` `/fixtures` `/changes` `/builder` `/scenarios`
  `/transfers` `/compare` `/status`)
- `lib/` — the model layer: `team-state.ts` plus the optimiser, lineup, scoring, squad-score,
  transfer and transfer-optimiser engines. All pure, so they are testable without React or network
- `components/` — UI components (shadcn/ui-style primitives in `components/ui`)
- `supabase/migrations/` — versioned schema changes
- `supabase/functions/` — Edge Functions (ingestion, predictions). Deno, and deliberately excluded
  from `tsconfig` and eslint, or `tsc --noEmit` breaks on Deno globals
- `.github/workflows/` — CI only (`ci.yml`). The deploy lives on Cloudflare
- `wrangler.jsonc` — Cloudflare Worker config: static assets from `out/`, no server script

## Deployment

Pushing to `main` triggers a Cloudflare build from the Git integration: `npm run build`, then
`wrangler deploy` serves `out/` as static assets per `wrangler.jsonc`. Node comes from `.nvmrc`.
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` must be **Cloudflare Build
variables**, not runtime bindings — a static export bakes them in at build time, and
`lib/supabase/client.ts` calls `createClient` at module scope, so a missing one fails the build
outright rather than degrading. The same two values are GitHub Secrets for `ci.yml`, which builds as
a quality gate without deploying.

Two things the Cloudflare setup wizard gets wrong for this project: it defaults the build command to
the OpenNext adapter (`npx opennextjs-cloudflare build`), which targets server-rendered Next and
fails on a static export, and it offers no base path — correctly, since the site is served from a
domain root. There is deliberately no `basePath` in `next.config.ts` any more.

## Database changes

Every schema change is a versioned SQL file in `supabase/migrations/`, applied to the Supabase
project and committed here. Migrations and function deploys go through the Supabase MCP OAuth
integration — the database password is never requested, stored, or accepted.
