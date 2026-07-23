import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8"
  );
}

const authFormSource = source("./AuthForm.tsx");
const loadingSource = source("./AppLoadingState.tsx");
const layoutSource = source("../app/layout.tsx");
const logoutRouteSource = source("../app/logout/route.ts");
const signOutSource = source("./SignOutControl.tsx");
const appShellSource = source("./AppShell.tsx");
const settingsSource = source("./SettingsForms.tsx");
const runtimeSource = source("./AppShellRuntime.tsx");
const timerSource = source("./PersistentTimerBar.tsx");

describe("web auth session-stability contracts", () => {
  it("prevents user-facing logout links and requires one explicit POST control", () => {
    expect(`${appShellSource}\n${settingsSource}`).not.toContain('href="/logout"');
    expect(appShellSource.match(/<SignOutControl/g)).toHaveLength(1);
    expect(settingsSource.match(/<SignOutControl/g)).toHaveLength(2);
    expect(signOutSource).toContain('action="/logout"');
    expect(signOutSource).toContain('method="post"');
    expect(signOutSource).toContain("submissionStarted.current");
    expect(signOutSource).toContain("Signing out…");
  });

  it("keeps logout GET side-effect free and POST redirect-based", () => {
    const getBody = logoutRouteSource.slice(
      logoutRouteSource.indexOf("export async function GET"),
      logoutRouteSource.indexOf("export async function POST")
    );
    expect(getBody).not.toContain("revokeLocalSession");
    expect(getBody).not.toContain("cookies.set");
    expect(logoutRouteSource).toContain('Location: "/login?signedOut=1"');
    expect(logoutRouteSource).toContain("303");
  });

  it("keeps useful form input controlled and successful login in one opening state", () => {
    expect(authFormSource).toContain("onSubmit={submit}");
    expect(authFormSource).toContain("event.preventDefault()");
    expect(authFormSource).toContain('type AuthFormStatus = "idle" | "submitting" | "opening" | "error" | "email-confirmation"');
    expect(authFormSource).toContain("value={email}");
    expect(authFormSource).toContain("value={password}");
    expect(authFormSource).toContain('setStatus("opening")');
    expect(authFormSource).toContain('window.location.replace("/")');
    expect(authFormSource).not.toContain("window.location.assign");
    expect(authFormSource).not.toContain("action={submit}");
    expect(authFormSource).not.toContain("localStorage");
    expect(authFormSource).not.toContain("setTimeout");
  });

  it("reuses the same branded loading component for root and post-login states", () => {
    expect(layoutSource).toContain("<AppLoadingState />");
    expect(authFormSource).toContain(
      '<AppLoadingState embedded message="Opening Dayframe…" />'
    );
    expect(loadingSource).toContain("<DayframeBrand");
    expect(loadingSource).toContain('role="status"');
  });

  it("reconciles bootstrap conservatively while elapsed time remains local", () => {
    expect(runtimeSource).toContain(
      "export const BOOTSTRAP_RECONCILE_INTERVAL_MS = 30_000"
    );
    expect(runtimeSource).toContain('window.addEventListener("focus"');
    expect(runtimeSource).toContain('document.addEventListener("visibilitychange"');
    expect(runtimeSource).not.toMatch(/setInterval\([^)]*1000/s);
    expect(timerSource).toContain(
      "window.setInterval(() => setNow(Date.now()), 1000)"
    );
  });
});
