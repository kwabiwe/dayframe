"use client";

import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Field, IconButton } from "@/components/ui/Primitives";
import { AuthCardMotion } from "@/components/AuthCardMotion";

type RecoveryTokens = { accessToken: string; refreshToken: string };
type Status = "reading" | "ready" | "saving" | "done" | "invalid";

/** Reads the recovery session Supabase puts in the link's fragment, then forgets it from the URL. */
export function readRecoveryTokens(hash: string): RecoveryTokens | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (params.get("type") !== "recovery" || !accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

/** Set a new password from a reset email (UIA-317). */
export function PasswordResetForm() {
  // Read once, on the client, from the link Supabase sent; the server render shows "reading".
  const [tokens, setTokens] = useState<RecoveryTokens | null>(() =>
    typeof window === "undefined" ? null : readRecoveryTokens(window.location.hash));
  const [status, setStatus] = useState<Status>(() =>
    typeof window === "undefined" ? "reading" : readRecoveryTokens(window.location.hash) ? "ready" : "invalid");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The tokens never stay in the address bar or history.
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  // When the form gives way to the outcome (changed, or the link no longer works), focus moves to
  // the heading and the outcome is announced; AuthCardMotion fades the outcome in and resizes the card.
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (status === "done" || status === "invalid") headingRef.current?.focus();
  }, [status]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tokens || status === "saving") return;
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      const response = await fetch("/api/auth/password-reset/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...tokens, password })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Dayframe couldn't change the password. Try again.");
        setStatus(response.status === 400 && /expired|used/i.test(payload.error ?? "") ? "invalid" : "ready");
        return;
      }
      setTokens(null);
      setStatus("done");
    } catch {
      setError("Dayframe couldn't change the password. Check your connection and try again.");
      setStatus("ready");
    }
  }

  return (
    <AuthCardMotion view={status === "done" || status === "invalid" ? status : "form"}>
    <section className="auth-card-view">
      <div className="auth-card-head">
        <h1 ref={headingRef} tabIndex={-1}>{status === "done" ? "Password changed" : "New password"}</h1>
        <p aria-live="polite">
          {status === "done"
            ? "You're signed out everywhere. Log in with your new password, on the web and on your iPhone."
            : status === "invalid"
              ? "This reset link has expired or was already used. Ask for a new one from Log in."
              : "Choose a new password for your Dayframe account."}
        </p>
      </div>
      {status === "ready" || status === "saving" ? (
        <form className="auth-card-form" onSubmit={submit} aria-busy={status === "saving"}>
          <Field htmlFor="reset-password" label="New password">
            <span className="ui-compound-control auth-password-field">
              <input
                aria-describedby="reset-password-hint"
                autoComplete="new-password"
                className="ui-control"
                disabled={status === "saving"}
                id="reset-password"
                minLength={8}
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type={showPassword ? "text" : "password"}
                value={password}
              />
              <IconButton
                label={showPassword ? "Hide password" : "Show password"}
                disabled={status === "saving"}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </IconButton>
            </span>
          </Field>
          <p className="auth-hint" id="reset-password-hint">At least 8 characters.</p>
          {error ? <p className="auth-message is-error" role="alert">{error}</p> : null}
          <Button className="w-full" disabled={status === "saving"} type="submit" variant="primary">
            {status === "saving" ? "Saving…" : "Set password"}
          </Button>
        </form>
      ) : null}
      {status === "done" || status === "invalid" ? (
        <p className="auth-switch auth-switch--standalone">
          <Link href="/login">Log in</Link>
        </p>
      ) : null}
    </section>
    </AuthCardMotion>
  );
}
