import type { Metadata } from "next";
import Link from "next/link";
import { DashboardNav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Lead Engine",
    template: "%s · Lead Engine",
  },
  description: "Find, verify and score B2B leads from the open web.",
  /* This is an operator console, not a public site. Nothing here should be
     indexed even if a URL leaks into a crawler's frontier. */
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Both faces are declared in globals.css, which the browser only
            discovers once the stylesheet parses. Preloading starts the two
            fetches in parallel with it instead, which keeps the swap window
            short enough that headings do not visibly reflow.

            crossOrigin is required even same-origin: fonts are always fetched
            in CORS mode, and without it the preload is discarded and refetched. */}
        <link
          rel="preload"
          href="/fonts/Palo-CompressedBold.woff2"
          as="font"
          type="font/woff2"
          crossOrigin=""
        />
        <link
          rel="preload"
          href="/fonts/BandaNova-Book.woff2"
          as="font"
          type="font/woff2"
          crossOrigin=""
        />
      </head>
      <body className="min-h-svh">
        <header className="nav-pill px-5 py-4 sm:px-10">
          <div className="mx-auto flex max-w-6xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <Link
              href="/"
              className="display inline-flex items-center gap-2.5 text-2xl"
            >
              <span
                className="size-3 flex-none rounded-full border-2 border-ink bg-yellow"
                aria-hidden="true"
              />
              Lead Engine
            </Link>
            <DashboardNav />
          </div>
        </header>

        <main className="px-5 py-10 sm:px-10 sm:py-14">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </body>
    </html>
  );
}
