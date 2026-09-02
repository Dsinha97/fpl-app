---
name: responsive-check
description: Drive the preview browser through the project's standard breakpoint x theme matrix (mobile/tablet/Zen-width/desktop, light/dark) and screenshot each for visual review. Use when asked to "check responsive layout", "test mobile", "resize check", or before shipping a layout change.
---

# Responsive Check

Past sessions re-derived the same breakpoint list by hand each time. This skill fixes it as
data in `breakpoints.json` instead.

## Breakpoints

`breakpoints.json` holds the canonical list, each tested at both `light` and `dark`
colorScheme:

- 375x812 — mobile (`mobile` preset — also emulates touch/Android UA)
- 768x1024 — tablet
- 1024x768 — tablet landscape
- 1208x900 — "Zen browser" width (a width that broke real layouts before — keep testing it)
- 1280x800 — desktop
- 1440x900 — wide desktop

## Procedure

1. `preview_start` the dev server (never Bash — see CLAUDE.md).
2. For each entry in `breakpoints.json` x each colorScheme, call `resize_window` with that
   width/height/colorScheme, navigate or reload the page under test, then take a
   `computer` screenshot.
3. Compare each screenshot for overflow, clipped text, or misaligned elements — this is a
   visual judgment call, not something the loop itself can decide.
4. Report exactly which breakpoint/theme combinations are broken and what's wrong — not
   just "looks fine" or "looks broken."

This doesn't replace judgment on what "looks right" — it only removes re-deriving which
sizes to check each time.
