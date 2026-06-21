import { describe, expect, it } from "vitest";
import {
  APP_SESSION_COOKIE,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeEmail,
  sessionCookieOptions,
  sessionTokenFromRequest,
  verifyPassword
} from "./local";

describe("local auth primitives", () => {
  it("normalizes emails before lookup", () => {
    expect(normalizeEmail("  Test1@Dayframe.Local ")).toBe("test1@dayframe.local");
  });

  it("hashes and verifies passwords without storing plaintext", async () => {
    const passwordHash = await hashPassword("local-only-password");
    expect(passwordHash).not.toContain("local-only-password");
    await expect(verifyPassword("local-only-password", passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", passwordHash)).resolves.toBe(false);
  });

  it("generates random session tokens and stable hashes", () => {
    const first = generateSessionToken();
    const second = generateSessionToken();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(40);
    expect(hashSessionToken(first)).toBe(hashSessionToken(first));
    expect(hashSessionToken(first)).not.toBe(first);
  });

  it("extracts app session tokens from bearer headers and cookies", () => {
    expect(
      sessionTokenFromRequest(
        new Request("http://localhost", {
          headers: { authorization: "Bearer mobile-token" }
        })
      )
    ).toBe("mobile-token");
    expect(
      sessionTokenFromRequest(
        new Request("http://localhost", {
          headers: { cookie: `${APP_SESSION_COOKIE}=web-token; other=value` }
        })
      )
    ).toBe("web-token");
  });

  it("uses an HTTP-only lax cookie for web sessions", () => {
    expect(sessionCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/"
    });
  });
});
