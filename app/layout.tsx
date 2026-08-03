import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FPL App",
  description: "Fantasy Premier League analytics and decision support",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 dark:bg-black">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <nav className="mx-auto flex h-14 w-full max-w-5xl items-center gap-6 px-4">
            <Link
              href="/"
              className="font-semibold tracking-tight text-zinc-950 dark:text-zinc-50"
            >
              FPL App
            </Link>
            <div className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-400">
              <Link
                href="/team"
                className="transition-colors hover:text-zinc-950 dark:hover:text-zinc-50"
              >
                My Team
              </Link>
              <Link
                href="/status"
                className="transition-colors hover:text-zinc-950 dark:hover:text-zinc-50"
              >
                Status
              </Link>
            </div>
          </nav>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
