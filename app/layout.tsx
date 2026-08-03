import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { Monogram, Wordmark } from "@/components/brand";
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
  title: "FPL Decision — Analytics Hub",
  description:
    "Fantasy Premier League analytics and decision support: transfers, captaincy, chips, and fixtures.",
};

const NAV = [
  { href: "/team", label: "My Team" },
  { href: "/players", label: "Players" },
  { href: "/fixtures", label: "Fixtures" },
  { href: "/changes", label: "Changes" },
  { href: "/status", label: "Status" },
] as const;

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
          <nav className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4">
            <Link href="/" className="flex items-center gap-2.5">
              <Monogram size={30} />
              <Wordmark />
            </Link>
            <div className="flex gap-4 overflow-x-auto text-sm text-zinc-600 dark:text-zinc-400">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="whitespace-nowrap transition-colors hover:text-purple-800 dark:hover:text-[#00FF87]"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
