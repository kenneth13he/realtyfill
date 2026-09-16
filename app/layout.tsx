// app/layout.tsx
// Root layout for the Next.js App Router. Wraps every page (intake, review, etc.)
// with shared HTML shell/providers. Loads Outfit via next/font (self-hosted at
// build time, no runtime request to Google Fonts) as the app's one typeface —
// previously the system font stack, which read as "unfinished" on the landing
// page per REMAINING_WORK.md item 20.

import type { Metadata } from "next";
import { Outfit, IBM_Plex_Mono } from "next/font/google";
import { ToastProvider } from "@/components/Toaster";
import "./globals.css";

// Geometric rather than neutral: the landing page runs very large display
// type, and Outfit holds its character at those sizes where Inter flattens out.
const outfit = Outfit({ subsets: ["latin"], variable: "--font-sans" });

// The data face. Counts, dates, statuses, form codes and field ids are
// readings, not prose, and setting them in a mono does more to make the app
// feel like an instrument than any amount of colour work — it also makes
// columns of dates line up, which Outfit's proportional digits never will.
// Plex Mono rather than a terminal face: it has the same humanist warmth as
// Outfit, so the pairing reads as deliberate instead of as a code block that
// wandered in. 500 only — this face is never body copy, so one weight is all
// it needs and one weight is all it should cost.
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "RealtyFill",
  description: "Five Ontario lease forms, one intake form. Fill it out once, review it, download all five.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${outfit.variable} ${plexMono.variable}`}>
      {/* ToastProvider is a Client Component, but `children` is passed to it
          as a prop rather than imported by it — so every page below stays a
          Server Component and none of this page's tree gets pulled into the
          client bundle. */}
      <body className="min-h-screen">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
