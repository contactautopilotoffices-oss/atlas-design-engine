import type { Metadata } from "next";
import { Suspense } from "react";
import "@fontsource-variable/inter";
import "@fontsource-variable/fraunces";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { StatusBanner } from "@/components/status-banner";

export const metadata: Metadata = {
  title: "ATLAS Design Engine",
  description: "Explore, combine and visualise interior designs from our project portfolio.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Suspense fallback={<div className="h-14 border-b border-stone-100" />}>
          <SiteHeader />
        </Suspense>
        <StatusBanner />
        <main className="flex-1 flex flex-col">
          {/* Pages read the URL (params, search) on the client, so they stream in after the static shell. */}
          <Suspense fallback={<div className="p-10 text-sm text-stone-600">Loading…</div>}>{children}</Suspense>
        </main>
      </body>
    </html>
  );
}
