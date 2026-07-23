import { describe, expect, it } from "vitest";
import {
  APP_SESSION_COOKIE,
  APP_SESSION_TTL_SECONDS,
  DEFAULT_APP_SESSION_TTL_SECONDS,
  MAX_APP_SESSION_TTL_SECONDS,
  MIN_APP_SESSION_TTL_SECONDS,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeEmail,
  resolveSessionTtlSeconds,
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
      path: "/",
      maxAge: APP_SESSION_TTL_SECONDS
    });
  });

  it("uses the documented 30-day session lifetime when the setting is absent", () => {
    expect(resolveSessionTtlSeconds(undefined)).toBe(DEFAULT_APP_SESSION_TTL_SECONDS);
    expect(DEFAULT_APP_SESSION_TTL_SECONDS).toBe(2_592_000);
  });

  it.each(["", " ", "0", "-1", "NaN", "Infinity", "60.5"])(
    "rejects invalid session TTL value %j",
    (value) => {
      expect(() => resolveSessionTtlSeconds(value)).toThrow(
        "DAYFRAME_SESSION_TTL_SECONDS"
      );
    }
  );

  it("accepts finite positive whole-second TTLs inside the supported range", () => {
    expect(resolveSessionTtlSeconds(String(MIN_APP_SESSION_TTL_SECONDS))).toBe(
      MIN_APP_SESSION_TTL_SECONDS
    );
    expect(resolveSessionTtlSeconds("86400")).toBe(86_400);
    expect(resolveSessionTtlSeconds(String(MAX_APP_SESSION_TTL_SECONDS))).toBe(
      MAX_APP_SESSION_TTL_SECONDS
    );
  });

  it("rejects session TTLs outside the supported range", () => {
    expect(() =>
      resolveSessionTtlSeconds(String(MIN_APP_SESSION_TTL_SECONDS - 1))
    ).toThrow("DAYFRAME_SESSION_TTL_SECONDS");
    expect(() =>
      resolveSessionTtlSeconds(String(MAX_APP_SESSION_TTL_SECONDS + 1))
    ).toThrow("DAYFRAME_SESSION_TTL_SECONDS");
  });
});
