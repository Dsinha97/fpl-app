"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// /chips merged into /transfers in Sprint 33, as its "Chip timing" tab. Both
// plan the same draft with the same engine (lib/chips, lib/chip-plan),
// /transfers already rendered a ChipPlanEditor, and chip timing is an input
// to the transfer path rather than a separate question — they were being read
// together and edited apart.
//
// This stub keeps old bookmarks and the ?draft= deep links from /builder and
// /scenarios working under trailingSlash: true, where a plain 404 would
// otherwise be the only outcome. Same shape as app/changes/page.tsx.
//
// router.replace() has to run in an effect, not the render body — calling it
// during render is a real React warning (see CLAUDE.md's gotchas list).
export default function ChipsRedirect() {
  const router = useRouter();

  useEffect(() => {
    const draft = new URLSearchParams(window.location.search).get("draft");
    const qs = new URLSearchParams({ tab: "chips" });
    if (draft) qs.set("draft", draft);
    router.replace(`/transfers?${qs.toString()}`);
  }, [router]);

  return null;
}
