import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getOptionalPageSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const session = await getOptionalPageSession();
  if (session) redirect("/");

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--background)] px-5 py-10 text-[var(--foreground)]">
      <AuthForm mode="signup" />
    </main>
  );
}
