import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Sprint 19: the design-token layer in app/globals.css is meaningless if new
// code can still hand-write the brand hex it duplicates. Rejects a raw
// 3/6/8-digit hex literal inside a `className` value (plain string or
// template literal) anywhere under app/ or components/ — use a token
// (bg-primary, text-danger, etc.) instead. lib/fdr.ts is exempt: its
// `hexCode` field is a deliberate non-className value consumed by SVG/canvas
// and its palette is CVD-validated, not decorative.
const NO_RAW_HEX_IN_CLASSNAME = {
  selector:
    "JSXAttribute[name.name='className'] Literal[value=/#[0-9a-fA-F]{3}([0-9a-fA-F]{3}([0-9a-fA-F]{2})?)?\\b/], " +
    "JSXAttribute[name.name='className'] TemplateElement[value.raw=/#[0-9a-fA-F]{3}([0-9a-fA-F]{3}([0-9a-fA-F]{2})?)?\\b/]",
  message:
    "Raw hex colour in className — use a design token from app/globals.css (e.g. bg-primary, text-danger, dark:bg-card) instead. See docs/wiki/design-system.md.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // lib/ is out of scope here: lib/fdr.ts's hex lives in a `hexCode` field,
    // never a className, so the selector below can't reach it anyway.
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["warn", NO_RAW_HEX_IN_CLASSNAME],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Supabase Edge Functions are Deno, not Next.js — linted by `deno lint`.
    "supabase/functions/**",
  ]),
]);

export default eslintConfig;
