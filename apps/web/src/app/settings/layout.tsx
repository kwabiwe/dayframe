import { redirect } from "next/navigation";
import { getOptionalPageSession, isAuthenticatedPageSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/**
 * Settings needs the signed-in app shell. A visitor without a session (the iPhone's "Open Dayframe
 * on the web" or "Export your data" in a fresh Safari) signs in first and comes back here; the
 * browser keeps a #section across the redirect.
 */
export default async function SettingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getOptionalPageSession();
  if (!isAuthenticatedPageSession(session)) redirect("/login?next=%2Fsettings");
  return children;
}
