import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/components/auth-provider";
import { DraftSyncProvider } from "@/components/draft-sync-provider";
import { Monogram, Wordmark } from "@/components/brand";
import { NavLinks } from "@/components/nav-links";
import { AccountMenu } from "@/components/account-menu";
import { THEME_BOOT_SCRIPT } from "@/components/theme";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/*
         * Applies the stored (or system) theme before first paint. Without
         * this a dark-mode user sees a white flash on every navigation, since
         * a static export has no server to resolve the preference.
         */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <DraftSyncProvider />
          <header className="border-b border-zinc-200 bg-white dark:border-purple-900/40 dark:bg-[#1E0234]">
            <nav className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4">
              <Link href="/" className="flex shrink-0 items-center gap-2.5">
                <Monogram size={30} />
                <Wordmark />
              </Link>
              <NavLinks />
              <div className="ml-auto flex shrink-0 items-center gap-3">
                <AccountMenu />
              </div>
            </nav>
          </header>
          <div className="flex flex-1 flex-col">{children}</div>
        </AuthProvider>
      </body>
    </html>
  );
}
