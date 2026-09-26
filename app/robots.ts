import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// Static export: generated once at build time into out/robots.txt. Cloudflare's
// "Manage your robots.txt" setting can override or prepend to this file, so
// if its setting is on, check that the live file still ends with the Sitemap line.
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Auth plumbing and account pages. These also carry noindex; Disallow
      // just saves crawl budget.
      disallow: ["/auth/", "/settings/", "/signin/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
