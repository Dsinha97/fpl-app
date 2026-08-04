import type { NextConfig } from "next";

// No basePath. The site is served from the root of its own hostname on
// Cloudflare Workers static assets.
//
// This used to derive one from GITHUB_REPOSITORY whenever GITHUB_ACTIONS was
// set, because GitHub Pages served the project at /fpl-app/. That is removed
// rather than left to resolve to "" by accident: it is only correct while
// nothing builds inside Actions, so the moment anything did again — a preview
// deploy, a smoke test — it would silently prefix every asset with /fpl-app and
// produce a page whose HTML looked fine and whose scripts all 404ed.

const nextConfig: NextConfig = {
  output: "export",
  // Emit team/index.html rather than team.html, so a direct hit on /team/
  // resolves. Cloudflare's default html_handling ("auto-trailing-slash") pairs
  // with this to serve both /team and /team/; see wrangler.jsonc. The nav's
  // active-link check strips the slash to match — components/nav-links.tsx.
  trailingSlash: true,
  images: {
    unoptimized: true,
    // Player kit graphics are served straight from FPL's CDN.
    remotePatterns: [
      { protocol: "https", hostname: "fantasy.premierleague.com", pathname: "/dist/img/**" },
    ],
  },
};

export default nextConfig;
