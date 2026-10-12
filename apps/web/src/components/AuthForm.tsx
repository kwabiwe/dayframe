"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AppLoadingState } from "@/components/AppLoadingState";
import { AuthCardMotion } from "@/components/AuthCardMotion";
import { Button, Field, IconButton, TextField } from "@/components/ui/Primitives";

type AuthMode = "login" | "signup";
type AuthFormStatus = "idle" | "submitting" | "opening" | "error" | "email-confirmation";

export function AuthForm({
  allowPasswordReset = false,
  mode,
  next = null
}: {
  /** Hosted (provider) sign-in only: "Forgot password?" sends a Supabase reset email (UIA-317). */
  allowPasswordReset?: boolean;
  mode: AuthMode;
  next?: string | null;
}) {
  const [resetting, setResetting] = useState(false);
  // Coming back from Reset password puts focus on this card's heading (not the page body).
  const [returnedFromReset, setReturnedFromReset] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (returnedFromReset && !resetting) headingRef.current?.focus();
  }, [resetting, returnedFromReset]);
  const [status, setStatus] = useState<AuthFormStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const submissionStarted = useRef(false);
  const navigationStarted = useRef(false);
  const router = useRouter();
  const isSignup = mode === "signup";
  // Switching between sign-in and sign-up keeps where to go afterwards.
  const otherModeHref = `${isSignup ? "/login" : "/signup"}${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  const formLocked =
    status === "submitting" ||
    status === "opening" ||
    status === "email-confirmation";

  useEffect(() => {
    if (status !== "opening" || navigationStarted.current) return;
    navigationStarted.current = true;
    // Back to where sign-in was asked for (a checked same-site path), keeping its #section.
    window.location.replace(next ? `${next}${window.location.hash}` : "/");
  }, [next, status]);

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
          // A new account gets its personal workspace (renamed in Settings; UIA-318).
          name: name || undefined
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

  // One motion owner for every view of the card (AuthCardMotion).
  const view = resetting ? "reset" : status === "opening" ? "opening" : isSignup ? "signup" : "login";
  return <AuthCardMotion view={view}>{renderView()}</AuthCardMotion>;

  function renderView() {
    if (resetting) {
      return (
        <PasswordResetRequest
          initialEmail={email}
          onBack={() => {
            setReturnedFromReset(true);
            setResetting(false);
          }}
        />
      );
    }

    if (status === "opening") {
      return (
        <section className="auth-card-view">
          <AppLoadingState embedded message="Opening Dayframe…" />
        </section>
      );
    }

    return (
      <section className="auth-card-view">
        <div className="auth-card-head">
          <h1 ref={headingRef} tabIndex={-1}>{isSignup ? "Create account" : "Log in"}</h1>
          <p>
            {isSignup
              ? "Create your Dayframe account and personal workspace."
              : "Use your Dayframe account to open your workspace."}
          </p>
        </div>
        <form className="auth-card-form" onSubmit={submit} aria-busy={status === "submitting"}>
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
                aria-describedby={isSignup ? "auth-password-hint" : undefined}
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
          {isSignup ? <p className="auth-hint" id="auth-password-hint">At least 8 characters.</p> : null}
          {!isSignup && allowPasswordReset ? (
            <button className="auth-forgot" disabled={formLocked} onClick={() => setResetting(true)} type="button">
              Forgot password?
            </button>
          ) : null}

          {error ? (
            <p className="auth-message is-error" role="alert">
              {error}
            </p>
          ) : null}

          {notice ? (
            <p className="auth-message" role="status">
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

          <p className="auth-switch">
            {isSignup ? "Already have an account?" : "New to Dayframe?"}{" "}
            <Link
              href={otherModeHref}
              onClick={(event) => {
                // Keep a #section (Settings › Privacy and data) across the switch too; a modified
                // click (new tab or window) keeps the browser's own behaviour.
                if (!window.location.hash || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                event.preventDefault();
                router.push(`${otherModeHref}${window.location.hash}`);
              }}
            >
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
}

/** "Forgot password?": ask for a reset email. The reply is the same for any address (UIA-317). */
function PasswordResetRequest({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  // The card replaces Log in (AuthCardMotion fades it in): focus moves to its heading, and back
  // there once the sent reply replaces the Send button.
  useEffect(() => {
    if (status === "idle" || status === "sent") headingRef.current?.focus();
    // On mount and once sent; an error keeps focus where it is (the alert announces it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status === "sent"]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending") return;
    setStatus("sending");
    setError(null);
    try {
      const response = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok) {
        setError(payload.error ?? "Dayframe couldn't send the reset email. Try again later.");
        setStatus("idle");
        return;
      }
      setMessage(payload.message ?? "If an account uses that email, a reset link is on its way. Check your email.");
      setStatus("sent");
    } catch {
      setError("Dayframe couldn't send the reset email. Check your connection and try again.");
      setStatus("idle");
    }
  }

  return (
    <section className="auth-card-view">
      <div className="auth-card-head">
        <h1 ref={headingRef} tabIndex={-1}>Reset password</h1>
        <p>We’ll email you a link to choose a new password.</p>
      </div>
      <form className="auth-card-form" onSubmit={send} aria-busy={status === "sending"}>
        <TextField
          id="reset-email"
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          value={email}
          disabled={status !== "idle"}
          onChange={(event) => setEmail(event.target.value)}
        />
        {error ? <p className="auth-message is-error" role="alert">{error}</p> : null}
        {message ? <p className="auth-message" role="status">{message}</p> : null}
        {status === "sent" ? null : (
          <Button className="w-full" disabled={status === "sending"} type="submit" variant="primary">
            {status === "sending" ? "Sending…" : "Send reset link"}
          </Button>
        )}
        <p className="auth-switch">
          <button className="auth-link-button" onClick={onBack} type="button">Back to Log in</button>
        </p>
      </form>
    </section>
  );
}
