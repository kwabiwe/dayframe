import type { Metadata } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import { cookies } from "next/headers";
import { Suspense } from "react";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { AppLoadingState } from "@/components/AppLoadingState";
import { AppShell } from "@/components/AppShell";
import { ClockFormatProvider } from "@/components/ClockFormat";
import { KeyboardFocusMarks } from "@/components/KeyboardFocusMarks";
import { getOptionalPageSession, isAuthenticatedPageSession } from "@/lib/auth/server";
import { CLOCK_FORMAT_COOKIE, clockFormatFromCookieValue } from "@/lib/clock-format";

// Bricolage Grotesque (SIL OFL, `fonts/BricolageGrotesque-OFL.txt`) is bundled and self-hosted:
// it is the Blocks display face for titles, the timer and large totals only.
const displayFont = localFont({
  src: [
    // SemiBold for the timer's digits (UI review round 2, owner 30 Oct 2026); same upstream release as Bold.
    { path: "./fonts/BricolageGrotesque-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/BricolageGrotesque-Bold.ttf", weight: "700", style: "normal" },
    { path: "./fonts/BricolageGrotesque-ExtraBold.ttf", weight: "800", style: "normal" }
  ],
  variable: "--font-display-face",
  display: "swap",
  fallback: ["ui-rounded", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"]
});

export const metadata: Metadata = {
  title: "Dayframe",
  description: "Customizable time intelligence for manual and location-based activity signals.",
  icons: {
    icon: "/logos/dayframe-colour-logo-transparent.svg"
  }
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getOptionalPageSession();
  // The browser's 12/24-hour format from its last visit, so the first paint matches it.
  const serverClockFormat = clockFormatFromCookieValue((await cookies()).get(CLOCK_FORMAT_COOKIE)?.value);

  return (
    <html lang="en" className={displayFont.variable} suppressHydrationWarning>
      <body>
        <Script
          id="dayframe-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('dayframe.theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}"
          }}
        />
        <ClockFormatProvider serverFormat={serverClockFormat}>
          <Suspense fallback={<AppLoadingState />}>
            {isAuthenticatedPageSession(session) ? <AppShell>{children}</AppShell> : children}
          </Suspense>
        </ClockFormatProvider>
        <KeyboardFocusMarks />
      </body>
    </html>
  );
}
