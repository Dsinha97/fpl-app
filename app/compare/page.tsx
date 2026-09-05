"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// /compare merged into /players in Sprint 33 — the comparison is now a
// slide-over panel on the player table rather than a page a click away.
// The two already fetched the same tables for the same gameweek and drew the
// same horizon control; the link between them carried a list of ids and
// nothing else, so the horizon you had just set was thrown away on the way
// over.
//
// This stub keeps old bookmarks, the builder's replacement-finder deep link,
// and any external links working under trailingSlash: true, where a plain 404
// would otherwise be the only outcome. Same shape as app/changes/page.tsx.
//
// ?ids= is forwarded and `panel=compare` is added, so a link that used to
// open a comparison still opens one rather than dropping the visitor on a
// table with some boxes ticked.
//
// router.replace() has to run in an effect, not the render body — calling it
// during render is a real React warning (see CLAUDE.md's gotchas list).
export default function CompareRedirect() {
  const router = useRouter();

  useEffect(() => {
    const ids = new URLSearchParams(window.location.search).get("ids");
    router.replace(ids ? `/players?ids=${encodeURIComponent(ids)}&panel=compare` : "/players");
  }, [router]);

  return null;
}
