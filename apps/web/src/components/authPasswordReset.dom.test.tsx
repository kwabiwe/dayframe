// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => createElement("a", { href, ...props }, children)
}));

const { AuthForm } = await import("./AuthForm");
const { readRecoveryTokens } = await import("./PasswordResetForm");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Forgot password and sign-up (UIA-317, UIA-318)", () => {
  it("offers Forgot password only with hosted sign-in, and only on Log in", () => {
    const { unmount } = render(<AuthForm mode="login" />);
    expect(screen.queryByRole("button", { name: "Forgot password?" })).toBeNull();
    unmount();
    render(<AuthForm allowPasswordReset mode="signup" />);
    expect(screen.queryByRole("button", { name: "Forgot password?" })).toBeNull();
  });

  it("sends the reset email and shows the same neutral reply for any address", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, message: "If an account uses that email, a reset link is on its way. Check your email." }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthForm allowPasswordReset mode="login" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "someone@example.invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("someone@example.invalid");
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Check your email"));
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/password-reset", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ email: "someone@example.invalid" })
    }));
    fireEvent.click(screen.getByRole("button", { name: "Back to Log in" }));
    expect(screen.getByRole("heading", { name: "Log in" })).toBeTruthy();
  });

  it("creates an account without a Workspace field and states the 8-character rule", () => {
    render(<AuthForm mode="signup" />);
    expect(screen.queryByLabelText("Workspace")).toBeNull();
    const password = screen.getByLabelText("Password");
    expect(password.getAttribute("aria-describedby")).toBe("auth-password-hint");
    expect(document.getElementById("auth-password-hint")?.textContent).toBe("At least 8 characters.");
  });

  it("reads only a recovery link's tokens", () => {
    expect(readRecoveryTokens("#access_token=a&refresh_token=r&type=recovery")).toEqual({ accessToken: "a", refreshToken: "r" });
    expect(readRecoveryTokens("#access_token=a&refresh_token=r&type=signup")).toBeNull();
    expect(readRecoveryTokens("#error=access_denied&error_description=expired")).toBeNull();
    expect(readRecoveryTokens("")).toBeNull();
  });
});
