"use client";

import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AppLoadingState } from "@/components/AppLoadingState";
import { Button, Field, IconButton, TextField } from "@/components/ui/Primitives";

type AuthMode = "login" | "signup";
type AuthFormStatus = "idle" | "submitting" | "opening" | "error" | "email-confirmation";

export function AuthForm({ mode }: { mode: AuthMode }) {
  const [status, setStatus] = useState<AuthFormStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const submissionStarted = useRef(false);
  const navigationStarted = useRef(false);
  const isSignup = mode === "signup";
  const formLocked =
    status === "submitting" ||
    status === "opening" ||
    status === "email-confirmation";

  useEffect(() => {
    if (status !== "opening" || navigationStarted.current) return;
    navigationStarted.current = true;
    window.location.replace("/");
  }, [status]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionStarted.current || formLocked) return;
    submissionStarted.current = true;
    setError(null);
    setNotice(null);
    setStatus("submitting");
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          name: name || undefined,
          workspaceName: workspaceName || undefined
        })
      });
      const payload = await readAuthResponse(response);
      if (!response.ok) {
        setError(payload.error ?? "Authentication failed.");
        setStatus("error");
        submissionStarted.current = false;
        return;
      }

      if (payload.requiresEmailConfirmation) {
        setNotice(payload.message ?? "Check your email to confirm your account, then log in.");
        setStatus("email-confirmation");
        return;
      }

      setStatus("opening");
    } catch {
      setError("Dayframe could not complete sign-in. Check your connection and try again.");
      setStatus("error");
      submissionStarted.current = false;
    }
  }

  if (status === "opening") {
    return (
      <section className="industrial-panel auth-card mx-auto w-full max-w-[440px]">
        <AppLoadingState embedded message="Opening Dayframe…" />
      </section>
    );
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
      <form className="grid gap-4 p-5" onSubmit={submit} aria-busy={status === "submitting"}>
        {isSignup ? (
          <>
            <TextField
              id="auth-name"
              label="Name"
              name="name"
              autoComplete="name"
              placeholder="Your name"
              value={name}
              disabled={formLocked}
              onChange={(event) => setName(event.target.value)}
            />
            <TextField
              id="auth-workspace"
              label="Workspace"
              name="workspaceName"
              autoComplete="organization"
              placeholder="Personal workspace"
              value={workspaceName}
              disabled={formLocked}
              onChange={(event) => setWorkspaceName(event.target.value)}
            />
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
          value={email}
          disabled={formLocked}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Field htmlFor="auth-password" label="Password">
          <span className="ui-compound-control auth-password-field">
            <input
              className="ui-control"
              id="auth-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={isSignup ? "new-password" : "current-password"}
              minLength={8}
              required
              value={password}
              disabled={formLocked}
              onChange={(event) => setPassword(event.target.value)}
            />
            <IconButton
              label={showPassword ? "Hide password" : "Show password"}
              disabled={formLocked}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </IconButton>
          </span>
        </Field>

        {error ? (
          <p className="border border-[var(--danger)] bg-[var(--surface-inset)] px-3 py-2 text-sm text-[var(--danger-text)]" role="alert">
            {error}
          </p>
        ) : null}

        {notice ? (
          <p className="border border-[var(--accent)] bg-[var(--surface-inset)] px-3 py-2 text-sm text-[var(--accent-text)]" role="status">
            {notice}
          </p>
        ) : null}

        <Button
          className="w-full"
          variant="primary"
          type="submit"
          disabled={formLocked}
          aria-live="polite"
        >
          {status === "submitting"
            ? isSignup ? "Creating account…" : "Logging in…"
            : status === "email-confirmation"
              ? "Check your email"
              : isSignup ? "Create account" : "Log in"}
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
