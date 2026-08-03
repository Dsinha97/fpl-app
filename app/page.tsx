"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Status = "checking" | "connected" | "error";

export default function Home() {
  const [status, setStatus] = useState<Status>("checking");
  const [detail, setDetail] = useState<string>("");

  useEffect(() => {
    supabase
      .from("health_check")
      .select("status, created_at")
      .limit(1)
      .single()
      .then(({ data, error }) => {
        if (error) {
          setStatus("error");
          setDetail(error.message);
          return;
        }
        setStatus("connected");
        setDetail(`status=${data.status} · created_at=${data.created_at}`);
      });
  }, []);

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-center gap-6 py-32 px-16 bg-white dark:bg-black">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          FPL Analytics & Decision Support
        </h1>
        <Link
          href="/team"
          className="rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Connect your team →
        </Link>
        <div className="flex flex-col items-center gap-2 text-center">
          <span
            className={
              status === "connected"
                ? "text-green-600 dark:text-green-400"
                : status === "error"
                  ? "text-red-600 dark:text-red-400"
                  : "text-zinc-500"
            }
          >
            Supabase: {status}
          </span>
          {detail && (
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              {detail}
            </span>
          )}
        </div>
      </main>
    </div>
  );
}
