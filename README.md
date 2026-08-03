# FPL App

Personal Fantasy Premier League analytics and decision-support application. See
[fpl_app_phase_wise_build_plan.md](./fpl_app_phase_wise_build_plan.md) for the full architecture and phased build plan.

## Phase plans

- [Phase 1 — FPL Data Ingestion](./docs/phase-1-plan.md)
- [Phase 4 — Expected Points (xP) Engine](./docs/phase-4-model.md)

## Stack

- Next.js (static export) + TypeScript + Tailwind CSS + shadcn/ui
- Supabase (Postgres, Auth, Edge Functions, Cron) as the system of record
- Hosted on GitHub Pages, deployed via GitHub Actions

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your Supabase project URL + publishable key
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project structure

- `app/` — Next.js routes
- `components/` — UI components (shadcn/ui in `components/ui`)
- `lib/supabase/` — Supabase client
- `supabase/migrations/` — versioned database schema changes
- `supabase/functions/` — Edge Functions (data ingestion, predictions, optimization)
- `.github/workflows/` — CI (`ci.yml`) and GitHub Pages deploy (`deploy.yml`)

## Deployment

Pushing to `main` triggers `deploy.yml`, which builds the static export and publishes it to GitHub Pages at
https://dsinha97.github.io/fpl-app/. Repo secrets `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are consumed at build time.

## Database changes

Every schema change is a versioned SQL file in `supabase/migrations/`, applied to the Supabase project and committed
to this repo.
