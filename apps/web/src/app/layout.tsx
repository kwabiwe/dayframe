import type { Metadata } from "next";
import Script from "next/script";
import { Suspense } from "react";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { getOptionalPageSession } from "@/lib/auth/server";

export const metadata: Metadata = {
  title: "Dayframe",
  description: "Customizable time intelligence for manual and location-based activity signals.",
  icons: {
    icon: "/logos/dayframe_logo.png"
  }
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getOptionalPageSession();

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script
          id="dayframe-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('dayframe.theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}"
          }}
        />
        <Suspense fallback={<>{children}</>}>
          {session ? <AppShell>{children}</AppShell> : children}
        </Suspense>
      </body>
    </html>
  );
}
