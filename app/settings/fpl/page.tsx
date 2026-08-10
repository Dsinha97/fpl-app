"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Sprint 14.3 — /settings/fpl became /settings/?tab=import, folded into the
// tabbed settings page alongside Account details. Kept as a redirect rather
// than deleted so the "Import your squad" link on /team's empty state (and
// any bookmark to the old path) doesn't 404.
export default function FplSettingsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/settings/?tab=import");
  }, [router]);

  return null;
}
