import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { DayframeBrand } from "@/components/brand/DayframeBrand";
import { getOptionalPageSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getOptionalPageSession();
  if (session) redirect("/");

  return (
    <main className="auth-page bg-[var(--background)] px-5 py-10 text-[var(--foreground)]">
      <Link href="/" className="auth-home-link" aria-label="Dayframe home">
        <DayframeBrand decorative size="lg" />
      </Link>
      <AuthForm mode="login" />
    </main>
  );
}
