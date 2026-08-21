"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// /changes was renamed to /news in Sprint 20 (it now also carries the RSS
// Feeds tab, so "changes" undersold what the page covers). This stub keeps
// old bookmarks and any external links working under trailingSlash: true,
// where a plain 404 would otherwise be the only outcome.
//
// router.replace() has to run in an effect, not the render body — calling
// it during render is a real React warning (see CLAUDE.md's gotchas list).
export default function ChangesRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/news");
  }, [router]);

  return null;
}
