# Search indexing (SEO): built 2026-09-26

No new sprint number. The owner submitted `fpldecision.com` to Google Search Console and asked
what else was needed. PR #39.

## What was there before

Checked against the live site before anything was built:

- `/robots.txt` was Cloudflare's managed content-signals file: comments only, with no rules and no
  `Sitemap:` line.
- `/sitemap.xml` returned 404.
- Every route shared one title and description, set once in the root layout. All 18 routes
  competed for the same query.
- No canonical tags, no Open Graph or Twitter tags, so a shared link had no preview card.

## What shipped

- **`lib/seo.ts`**: `SITE_ROUTES` holds each public route's path, title, description and sitemap
  hints. `routeMetadata()` turns one into title, description, canonical, Open Graph and Twitter
  tags. `noindexMetadata()` marks a route `noindex, follow`. The sitemap reads the same list, so a
  route can't be in the sitemap without a title and canonical.
- **`app/sitemap.ts` and `app/robots.ts`**, `force-static` so the export writes
  `out/sitemap.xml` and `out/robots.txt`. The sitemap lists 10 routes. robots.txt disallows
  `/auth/`, `/settings/` and `/signin/` and names the sitemap.
- **A `layout.tsx` per route** exporting `metadata`. Every page is a client component and can't
  export it itself.
  - Indexable: `/`, `/deadline`, `/players`, `/fixtures`, `/transfers`, `/builder`, `/scenarios`,
    `/news`, `/team`, `/leagues`.
  - `noindex`: `/shortlist`, `/settings`, `/signin`, `/auth`, and the five redirect stubs
    (`/changes`, `/chips`, `/compare`, `/review`, `/status`). `/team` stays indexable because
    signed out it is the enter-your-manager-ID page.
- **Home split** into a server `app/page.tsx` wrapping `app/home-client.tsx`, so the `/` canonical
  lives on the home route and not in the root layout.
- **`public/og-image.png`**, a 1200×630 preview card in the brand colours, referenced from every
  route.

## Decisions and gotchas

- **No canonical in the root layout.** Metadata is inherited, so a canonical of `/` there would
  tell Google that any route without its own layout is a duplicate of the home page.
- **No canonical on noindex routes.** Google treats `noindex` plus a canonical pointing elsewhere as
  conflicting signals. A redirect stub's client-side redirect already says where the page went.
- **The `opengraph-image` file convention doesn't suit this export.** It was tried first. Under
  `output: "export"` it writes `out/opengraph-image` with no extension, and a route that sets its
  own `openGraph` object drops the inherited image anyway. The rendered image was saved as a plain
  PNG in `public/` and referenced explicitly from `routeMetadata()`.
- **Cloudflare can replace robots.txt.** The setting is now under AI bot policies as "Bot
  Preference Sync", which prepends Cloudflare's rules to the site's own file. It was left off.
  After deploy the live `/robots.txt` matched the built file exactly.

## Outside the repo (owner, 2026-09-26)

- Google Search Console: sitemap submitted and read ("Success", 10 discovered pages), and indexing
  requested for `/`, `/players/`, `/fixtures/`, `/deadline/`, `/transfers/`.
- Bing Webmaster Tools: imported from Search Console.
- Cloudflare Crawler Hints turned on. It sends IndexNow pings to Bing and others; Google doesn't
  use IndexNow.
- GitHub repo topics `fpl`, `fantasy-football` and `premier-league` added. GitHub marks README and
  About links `nofollow`, so they help people find the site, not its ranking.
- deepayansinha.com: the home page mention of fpldecision.com is now a followed link, alongside
  the case study's existing one.

## Verification

`tsc`, lint and `build` passed. Tags were checked in `out/*.html`, and the home page rendered in the
preview with no console errors. After deploy, `/sitemap.xml` returned 200, `/og-image.png` served as
`image/png`, and `/robots.txt` matched the built file.

## Still to check

Search Console → Indexing → Pages in one to two weeks. "Crawled – currently not indexed" on a route
would most likely mean too little static text, since every page builds its content in the browser.
The fix would be a line or two of static intro copy on that route.
