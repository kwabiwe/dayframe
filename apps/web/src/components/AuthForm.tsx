"use client";

import Link from "next/link";
import { useState } from "react";

type AuthMode = "login" | "signup";

export function AuthForm({ mode }: { mode: AuthMode }) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSignup = mode === "signup";

  async function submit(formData: FormData) {
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.get("email"),
          password: formData.get("password"),
          name: formData.get("name") || undefined,
          workspaceName: formData.get("workspaceName") || undefined
        })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Authentication failed.");
        return;
      }

      window.location.assign("/");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="industrial-panel mx-auto w-full max-w-[440px]">
      <div className="border-b border-[var(--line)] px-5 py-4">
        <h1 className="text-2xl font-semibold">{isSignup ? "Create account" : "Log in"}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {isSignup
            ? "Create a local Dayframe user and workspace in this Postgres database."
            : "Use your local Dayframe account to open your workspace."}
        </p>
      </div>
      <form action={submit} className="grid gap-4 p-5">
        {isSignup ? (
          <>
            <label className="grid gap-2 text-sm font-medium">
              Name
              <input
                className="industrial-field"
                name="name"
                autoComplete="name"
                placeholder="Local test user"
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Workspace
              <input
                className="industrial-field"
                name="workspaceName"
                autoComplete="organization"
                placeholder="My Dayframe"
              />
            </label>
          </>
        ) : null}
        <label className="grid gap-2 text-sm font-medium">
          Email
          <input
            className="industrial-field"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="test1@dayframe.local"
            required
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Password
          <input
            className="industrial-field"
            name="password"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            minLength={8}
            required
          />
        </label>

        {error ? (
          <p className="border border-[var(--danger)] bg-[var(--surface-inset)] px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}

        <button
          className="focus-ring min-h-11 border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 font-semibold text-[var(--on-accent)] disabled:opacity-60"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Working..." : isSignup ? "Create account" : "Log in"}
        </button>

        <p className="text-sm text-[var(--muted)]">
          {isSignup ? "Already have a local account?" : "Need a local account?"}{" "}
          <Link className="font-semibold text-[var(--accent)]" href={isSignup ? "/login" : "/signup"}>
            {isSignup ? "Log in" : "Create one"}
          </Link>
        </p>
      </form>
    </section>
  );
}
