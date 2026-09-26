import type { Metadata } from "next";

// One place for per-route search metadata. Every route under app/ is a client
// component, so a route's metadata lives in a sibling layout.tsx that calls
// routeMetadata() — the page itself cannot export it.
//
// SITE_ROUTES is also what app/sitemap.ts lists, so a route can't be in the
// sitemap without a title and canonical, or the reverse.

export const SITE_URL = "https://fpldecision.com";
export const SITE_NAME = "FPL Decision";

// The link-preview card (1200×630). A plain file in public/, referenced
// explicitly: the opengraph-image file convention exports without a .png
// extension under output: "export", and a route that sets its own openGraph
// object would drop an inherited image anyway.
export const OG_IMAGE = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
  alt: "FPL Decision — Fantasy Premier League analytics hub",
};

export interface SiteRoute {
  /** With the trailing slash — trailingSlash: true makes that the canonical form. */
  path: string;
  title: string;
  description: string;
  changeFrequency: "daily" | "weekly" | "monthly";
  priority: number;
}

export const SITE_ROUTES = {
  home: {
    path: "/",
    title: "FPL Decision — Fantasy Premier League Analytics Hub",
    description:
      "Free Fantasy Premier League analytics: expected points projections, transfer planning, fixture difficulty, captaincy and chip strategy for every gameweek.",
    changeFrequency: "daily",
    priority: 1,
  },
  deadline: {
    path: "/deadline/",
    title: "FPL Deadline Hub — Gameweek Checklist, Team News & Price Changes",
    description:
      "Everything to check before the FPL deadline: countdown, team news, injury flags, price rises and falls, and captain picks for the coming gameweek.",
    changeFrequency: "daily",
    priority: 0.9,
  },
  players: {
    path: "/players/",
    title: "FPL Player Explorer — Expected Points, Stats & Comparison",
    description:
      "Search and compare every Fantasy Premier League player by projected points, price, form, minutes and fixtures, over any horizon from one gameweek to the season.",
    changeFrequency: "daily",
    priority: 0.9,
  },
  fixtures: {
    path: "/fixtures/",
    title: "FPL Fixture Difficulty (FDR) Ticker",
    description:
      "Premier League fixture difficulty for every club, gameweek by gameweek — find the best runs of fixtures for FPL transfers and chips.",
    changeFrequency: "daily",
    priority: 0.9,
  },
  transfers: {
    path: "/transfers/",
    title: "FPL Transfer Planner & Chip Timing Simulator",
    description:
      "Plan Fantasy Premier League transfers across multiple gameweeks: expected-points gain against hits, and when to play Wildcard, Free Hit, Bench Boost and Triple Captain.",
    changeFrequency: "daily",
    priority: 0.8,
  },
  builder: {
    path: "/builder/",
    title: "FPL Team Builder — Squad Optimiser",
    description:
      "Build a legal 15-player FPL squad within budget, or let the optimiser pick one for projected points over your chosen horizon.",
    changeFrequency: "weekly",
    priority: 0.8,
  },
  scenarios: {
    path: "/scenarios/",
    title: "FPL Scenario Lab — Compare Squad Drafts",
    description:
      "Compare alternative Fantasy Premier League squads side by side on projected points, fixtures and budget before you commit to a plan.",
    changeFrequency: "weekly",
    priority: 0.7,
  },
  news: {
    path: "/news/",
    title: "FPL News — Injuries, Price Changes & What Changed",
    description:
      "What changed in Fantasy Premier League since you last looked: injury and availability news, price changes and FPL news feeds in one place.",
    changeFrequency: "daily",
    priority: 0.8,
  },
  team: {
    path: "/team/",
    title: "FPL Team Analysis — Connect Your Manager ID",
    description:
      "Enter your FPL manager ID to see your squad's projected points, gameweek review, captaincy options and season history.",
    changeFrequency: "weekly",
    priority: 0.7,
  },
  leagues: {
    path: "/leagues/",
    title: "FPL Mini-League Effective Ownership",
    description:
      "Real effective ownership for your Fantasy Premier League mini-leagues — see which players and captains you need to cover your rivals.",
    changeFrequency: "weekly",
    priority: 0.6,
  },
} satisfies Record<string, SiteRoute>;

function openGraph(path: string, title: string, description: string): Metadata["openGraph"] {
  return {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_GB",
    url: path,
    title,
    description,
    images: [OG_IMAGE],
  };
}

/** Metadata for an indexable route: absolute title, canonical, Open Graph and Twitter. */
export function routeMetadata(route: SiteRoute): Metadata {
  return {
    // absolute: the titles already carry their own FPL keywords, so the root
    // "%s | FPL Decision" template would only repeat the brand.
    title: { absolute: route.title },
    description: route.description,
    alternates: { canonical: route.path },
    openGraph: openGraph(route.path, route.title, route.description),
    twitter: {
      card: "summary_large_image",
      title: route.title,
      description: route.description,
      images: [OG_IMAGE.url],
    },
  };
}

/**
 * Metadata for a route that must stay out of the index: personal pages, auth
 * plumbing, and the redirect stubs kept for old links. `follow` stays on so a
 * crawler that lands here still reaches the rest of the site. No canonical —
 * Google treats noindex plus a canonical elsewhere as conflicting signals, and
 * a stub's client-side redirect already tells it where the page went.
 */
export function noindexMetadata(title: string): Metadata {
  return { title, robots: { index: false, follow: true } };
}
