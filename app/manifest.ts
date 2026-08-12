import type { MetadataRoute } from "next";

// Required for output: "export" — Next won't prerender a route handler like
// this into the static export unless it's explicitly marked static.
export const dynamic = "force-static";

// Static export: Next prerenders this to out/manifest.webmanifest at build
// time, same as icon.svg / apple-icon.png are prerendered from their route
// files. Colors match the brand mark (components/brand.tsx) and the dark
// page background (globals.css).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FPL Decision — Analytics Hub",
    short_name: "FPL Decision",
    description:
      "Fantasy Premier League analytics and decision support: transfers, captaincy, chips, and fixtures.",
    start_url: "/",
    display: "standalone",
    background_color: "#0E0118",
    theme_color: "#2E073F",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      // Android's adaptive-icon mask clips or letterboxes an "any" icon
      // depending on device shape. This variant fills edge-to-edge with the
      // brand plate color, so any mask shape crops safely — see
      // scripts/generate-icons.mjs for how it's derived from app/icon.svg.
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
