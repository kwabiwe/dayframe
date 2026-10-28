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
import { getOptionalPageSession, isAuthenticatedPageSession } from "@/lib/auth/server";
import { CLOCK_FORMAT_COOKIE, clockFormatFromCookieValue } from "@/lib/clock-format";
import { CalendarPrototypeProvider } from "@/components/CalendarPrototype";
import { CALENDAR_PROTOTYPE_COOKIE, calendarPrototypeOn } from "@/lib/calendar-prototype";

// Bricolage Grotesque (SIL OFL, `fonts/BricolageGrotesque-OFL.txt`) is bundled and self-hosted:
// it is the Blocks display face for titles, the timer and large totals only.
const displayFont = localFont({
  src: [
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
  const cookieStore = await cookies();
  const serverClockFormat = clockFormatFromCookieValue(cookieStore.get(CLOCK_FORMAT_COOKIE)?.value);
  // The Calendar prototype (staging and local only), decided once so the server render and first paint agree.
  const calendarPrototype = calendarPrototypeOn(cookieStore.get(CALENDAR_PROTOTYPE_COOKIE)?.value);

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
          <CalendarPrototypeProvider on={calendarPrototype}>
            <Suspense fallback={<AppLoadingState />}>
              {isAuthenticatedPageSession(session) ? <AppShell>{children}</AppShell> : children}
            </Suspense>
          </CalendarPrototypeProvider>
        </ClockFormatProvider>
      </body>
    </html>
  );
}
