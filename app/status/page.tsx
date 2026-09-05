"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// /status merged into /settings in Sprint 33, as its "Pipeline" tab. Sprint 22
// had already taken it out of the nav on the reasoning that a data-freshness
// page belongs beside account settings; this finishes that move rather than
// leaving a route reachable only from a dropdown.
//
// This stub keeps old bookmarks working under trailingSlash: true, where a
// plain 404 would otherwise be the only outcome. Same shape as
// app/changes/page.tsx.
//
// router.replace() has to run in an effect, not the render body — calling it
// during render is a real React warning (see CLAUDE.md's gotchas list).
export default function StatusRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/settings?tab=status");
  }, [router]);

  return null;
}
