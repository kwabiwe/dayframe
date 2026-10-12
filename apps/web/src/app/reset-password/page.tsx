import Link from "next/link";
import { notFound } from "next/navigation";
import { PasswordResetClient } from "@/components/PasswordResetClient";
import { DayframeBrand } from "@/components/brand/DayframeBrand";
import { getAuthMode } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Where a Supabase recovery email returns (UIA-317); hosted (provider) sign-in only. */
export default function ResetPasswordPage() {
  if (getAuthMode() !== "provider") notFound();
  return (
    <main className="auth-page bg-[var(--background)] px-5 py-10 text-[var(--foreground)]">
      <Link href="/" className="auth-home-link" aria-label="Dayframe home">
        <DayframeBrand decorative size="lg" />
      </Link>
      <PasswordResetClient />
    </main>
  );
}
