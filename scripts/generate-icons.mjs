// Regenerates every raster icon asset from app/icon.svg.
//
// Why this exists: the previous PNGs (public/icon-192.png, public/icon-512.png,
// app/apple-icon.png) were produced ad hoc from an icon.svg that colored its
// strokes via CSS custom properties (var(--stem), var(--accent-g)) declared on
// a bare `:root` inside the SVG. Whatever tool rasterized them didn't resolve
// custom properties, so the stem and F/D strokes fell back to nothing/black —
// the "too dark" home-screen icon. icon.svg now uses literal hex and
// fill="none" on the stroke group instead (see the comment there), and this
// script is the reproducible way to turn that into the PNG set, rather than
// another hand-made binary.
//
// Requires `sharp` to be resolvable — it is not a project dependency (kept out
// of package.json deliberately, per the "no permanent dependency" call in the
// PWA-polish plan). Run once via:
//   npm install --no-save sharp && node scripts/generate-icons.mjs && npm uninstall --no-save sharp
//
// Usage: node scripts/generate-icons.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconSvgPath = path.join(root, "app", "icon.svg");
const iconSvg = readFileSync(iconSvgPath, "utf8");

// A maskable variant needs to fill the canvas edge-to-edge (Android applies
// its own corner/shape mask), so the rounded rect's rx is dropped. The mark
// itself (stem, F, D, dot) is untouched: its extremities are all within ~11.3
// units of the 16,16 center, comfortably inside the safe zone's 12.8-unit
// radius (80% of the 32x32 canvas), so no additional scaling is needed.
const maskableSvg = iconSvg.replace(
  /<rect width="32" height="32" rx="8" fill="#2E073F"\/>/,
  '<rect width="32" height="32" fill="#2E073F"/>',
);
if (maskableSvg === iconSvg) {
  throw new Error("app/icon.svg background <rect> didn't match the expected shape — update the replace pattern above.");
}

const DENSITY = 384; // renders the 32x32 viewBox at high enough resolution to downsample cleanly to 512px

async function render(svg, size, outPath) {
  await sharp(Buffer.from(svg), { density: DENSITY })
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log(`wrote ${path.relative(root, outPath)} (${size}x${size})`);
}

await render(iconSvg, 192, path.join(root, "public", "icon-192.png"));
await render(iconSvg, 512, path.join(root, "public", "icon-512.png"));
await render(iconSvg, 180, path.join(root, "app", "apple-icon.png"));
await render(maskableSvg, 512, path.join(root, "public", "icon-maskable-512.png"));

writeFileSync(path.join(root, "public", "logo.svg"), iconSvg);
console.log("synced public/logo.svg with app/icon.svg");
