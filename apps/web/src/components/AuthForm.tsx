"use client";

import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Button, Field, IconButton, TextField } from "@/components/ui/Primitives";

type AuthMode = "login" | "signup";

export function AuthForm({ mode }: { mode: AuthMode }) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isSignup = mode === "signup";

  async function submit(formData: FormData) {
    setError(null);
    setNotice(null);
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
      const payload = await readAuthResponse(response);
      if (!response.ok) {
        setError(payload.error ?? "Authentication failed.");
        return;
      }

      if (payload.requiresEmailConfirmation) {
        setNotice(payload.message ?? "Check your email to confirm your account, then log in.");
        return;
      }

      window.location.assign("/");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="industrial-panel auth-card mx-auto w-full max-w-[440px]">
      <div className="border-b border-[var(--line)] px-5 py-4">
        <h1 className="text-2xl font-semibold">{isSignup ? "Create account" : "Log in"}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {isSignup
            ? "Create your Dayframe account and personal workspace."
            : "Use your Dayframe account to open your workspace."}
        </p>
      </div>
      <form action={submit} className="grid gap-4 p-5">
        {isSignup ? (
          <>
            <TextField id="auth-name" label="Name" name="name" autoComplete="name" placeholder="Your name" />
            <TextField id="auth-workspace" label="Workspace" name="workspaceName" autoComplete="organization" placeholder="Personal workspace" />
          </>
        ) : null}
        <TextField
          id="auth-email"
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
        />
        <Field htmlFor="auth-password" label="Password">
          <span className="auth-password-field">
            <input
              className="ui-control"
              id="auth-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={isSignup ? "new-password" : "current-password"}
              minLength={8}
              required
            />
            <IconButton
              label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </IconButton>
          </span>
        </Field>

        {error ? (
          <p className="border border-[var(--danger)] bg-[var(--surface-inset)] px-3 py-2 text-sm text-[var(--danger-text)]">
            {error}
          </p>
        ) : null}

        {notice ? (
          <p className="border border-[var(--accent)] bg-[var(--surface-inset)] px-3 py-2 text-sm text-[var(--accent-text)]">
            {notice}
          </p>
        ) : null}

        <Button
          className="w-full"
          variant="primary"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Working..." : isSignup ? "Create account" : "Log in"}
        </Button>

        <p className="text-sm text-[var(--muted)]">
          {isSignup ? "Already have an account?" : "New to Dayframe?"}{" "}
          <Link className="font-semibold text-[var(--accent-text)]" href={isSignup ? "/login" : "/signup"}>
            {isSignup ? "Log in" : "Create one"}
          </Link>
        </p>
      </form>
    </section>
  );
}

async function readAuthResponse(response: Response) {
  const text = await response.text();
  if (!text) {
    return {
      error: response.ok ? undefined : "Authentication failed. Please try again."
    };
  }

  try {
    return JSON.parse(text) as { error?: string; message?: string; requiresEmailConfirmation?: boolean };
  } catch {
    return {
      error: response.ok ? undefined : "Authentication failed. Please try again."
    };
  }
}
