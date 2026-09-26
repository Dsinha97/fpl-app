import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/components/auth-provider";
import { DraftSyncProvider } from "@/components/draft-sync-provider";
import { Monogram, Wordmark } from "@/components/brand";
import { DesktopNav, MobileNav } from "@/components/nav-links";
import { AccountMenu } from "@/components/account-menu";
import { ContextBar } from "@/components/context-bar";
import { THEME_BOOT_SCRIPT } from "@/components/theme";
import { OG_IMAGE, SITE_NAME, SITE_ROUTES, SITE_URL } from "@/lib/seo";
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
  metadataBase: new URL(SITE_URL),
  // Routes set their own titles through lib/seo.ts; the template only fills in
  // for the noindex routes, which pass a bare name. No canonical here — a
  // child that forgot its own would inherit "/" and ask to be merged into home.
  title: { default: SITE_ROUTES.home.title, template: `%s | ${SITE_NAME}` },
  description: SITE_ROUTES.home.description,
  applicationName: SITE_NAME,
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_GB", images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", images: [OG_IMAGE.url] },
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
          <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white dark:border-purple-900/40 dark:bg-card">
            <nav className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:gap-6">
              {/* MobileNav renders first so its trigger is leftmost below
                  `lg` — reachable without reaching across the wordmark from
                  either hand. It's `lg:hidden` internally, so at desktop
                  widths it contributes nothing and this has no effect on the
                  logo/nav/account order below. */}
              <MobileNav />
              <Link href="/" className="flex shrink-0 items-center gap-2.5">
                <Monogram size={30} />
                <Wordmark />
              </Link>
              <DesktopNav />
              <div className="ml-auto flex shrink-0 items-center gap-3">
                <AccountMenu />
              </div>
            </nav>
            <ContextBar />
          </header>
          <div className="flex flex-1 flex-col">{children}</div>
        </AuthProvider>
      </body>
    </html>
  );
}
