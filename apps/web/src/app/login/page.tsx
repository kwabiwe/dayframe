import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { DayframeBrand } from "@/components/brand/DayframeBrand";
import { getOptionalPageSession } from "@/lib/auth/server";
import { safeNextPath } from "@/lib/auth/next-path";
import { getAuthMode } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Where to go once signed in (a same-site path only), e.g. Settings from the iPhone.
  const next = safeNextPath((await searchParams).next);
  const session = await getOptionalPageSession();
  if (session) redirect(next ?? "/");

  return (
    <main className="auth-page bg-[var(--background)] px-5 py-10 text-[var(--foreground)]">
      <Link href="/" className="auth-home-link" aria-label="Dayframe home">
        <DayframeBrand decorative size="lg" />
      </Link>
      <AuthForm allowPasswordReset={getAuthMode() === "provider"} mode="login" next={next} />
    </main>
  );
}
