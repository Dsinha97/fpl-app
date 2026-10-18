# Platform (Map of Content)

Up: [Wiki home](../index.md)

What runs underneath: ingestion, the database and its access rules, Edge Functions, the FPL API, hosting and speed.

| Page | What it covers |
|---|---|
| [data-pipeline.md](../data-pipeline.md) | Edge Functions, cron cadence, change-detected snapshotting |
| [news-feed.md](../news-feed.md) | RSS ingestion, table-driven feed config, tiered player/club entity resolution, where headlines surface |
| [database-and-rls.md](../database-and-rls.md) | The two RLS shapes this schema uses, and how to verify a new policy |
| [edge-function-security.md](../edge-function-security.md) | Who may call `/functions/v1/*` — three caller classes, Vault-held secrets, the rate limit as an input |
| [notifications-and-bot.md](../notifications-and-bot.md) | The Telegram bot both ways — the outbox dedupe key, the chat-id allowlist, and the line the Deno boundary draws |
| [fpl-api-constraints.md](../fpl-api-constraints.md) | Row caps, pre-season placeholder fields, asset URL shapes |
| [fpl-authentication.md](../fpl-authentication.md) | Why credential login is blocked, and the three generations of workaround |
| [deployment.md](../deployment.md) | Static export on Cloudflare Workers — build-vs-runtime variables, routing gotchas |
| [performance.md](../performance.md) | Measured latency baseline, the serial-pagination and `/team` sync-on-load fixes, Sprint 40's bundle attribution and waterfall collapse, the price-watch scan still open, and what a generic web-perf playbook does/doesn't apply here |
