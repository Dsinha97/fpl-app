"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// /review merged into /team in Sprint 33. It was the post-mortem on a
// finished gameweek — which is what /team's gameweek selector already was,
// asked on a second page with a second event picker that could disagree with
// the first. The review now renders under that one selector whenever the
// gameweek in it is finished.
//
// This stub keeps old bookmarks and any ?event= deep links working under
// trailingSlash: true, where a plain 404 would otherwise be the only outcome.
// Same shape as app/changes/page.tsx.
//
// router.replace() has to run in an effect, not the render body — calling it
// during render is a real React warning (see CLAUDE.md's gotchas list).
export default function ReviewRedirect() {
  const router = useRouter();

  useEffect(() => {
    const event = new URLSearchParams(window.location.search).get("event");
    router.replace(event ? `/team?event=${encodeURIComponent(event)}` : "/team");
  }, [router]);

  return null;
}
