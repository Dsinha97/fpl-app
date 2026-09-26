import type { MetadataRoute } from "next";
import { SITE_ROUTES, SITE_URL } from "@/lib/seo";

// Static export: generated once at build time into out/sitemap.xml.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return Object.values(SITE_ROUTES).map((route) => ({
    url: `${SITE_URL}${route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
