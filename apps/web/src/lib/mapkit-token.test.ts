import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MAPKIT_TOKEN_TTL_SECONDS, mapKitConfig, signMapKitToken } from "@/lib/mapkit-token";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

describe("MapKit JS tokens", () => {
  it("needs all three variables and a readable key", () => {
    expect(mapKitConfig({})).toBeNull();
    expect(mapKitConfig({ MAPKIT_JS_TEAM_ID: "TEAM123456", MAPKIT_JS_KEY_ID: "KEY1234567" })).toBeNull();
    expect(mapKitConfig({ MAPKIT_JS_TEAM_ID: "TEAM123456", MAPKIT_JS_KEY_ID: "KEY1234567", MAPKIT_JS_PRIVATE_KEY: "not a key" })).toBeNull();
    // A one-line .p8 with escaped newlines, as hosted environments store it.
    const oneLine = pem.replace(/\n/g, "\\n");
    expect(mapKitConfig({ MAPKIT_JS_TEAM_ID: "TEAM123456", MAPKIT_JS_KEY_ID: "KEY1234567", MAPKIT_JS_PRIVATE_KEY: oneLine })).not.toBeNull();
  });

  it("refuses IDs that aren't 10-character Apple identifiers, so nothing else reaches a token header", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const leaky = `KEY1234567\n${pem}`;
    expect(mapKitConfig({ MAPKIT_JS_TEAM_ID: "TEAM123456", MAPKIT_JS_KEY_ID: leaky, MAPKIT_JS_PRIVATE_KEY: pem })).toBeNull();
    expect(mapKitConfig({ MAPKIT_JS_TEAM_ID: "team 123", MAPKIT_JS_KEY_ID: "KEY1234567", MAPKIT_JS_PRIVATE_KEY: pem })).toBeNull();
    expect(error.mock.calls.map(([message]) => String(message))).toEqual([
      "MapKit JS is off: MAPKIT_JS_KEY_ID must be a 10-character Apple identifier.",
      "MapKit JS is off: MAPKIT_JS_TEAM_ID must be a 10-character Apple identifier."
    ]);
    expect(JSON.stringify(error.mock.calls)).not.toContain("PRIVATE KEY");
    error.mockRestore();
  });

  it("signs an ES256 token for one origin that expires in 30 minutes", () => {
    const config = mapKitConfig({ MAPKIT_JS_TEAM_ID: "TEAM123456", MAPKIT_JS_KEY_ID: "KEY1234567", MAPKIT_JS_PRIVATE_KEY: pem })!;
    const now = Date.UTC(2026, 9, 29, 20, 0, 0);
    const { token, expiresAt } = signMapKitToken(config, "https://dayframe-staging.vercel.app", now);
    const [header, payload, signature] = token.split(".");
    expect(decode(header)).toEqual({ alg: "ES256", kid: "KEY1234567", typ: "JWT" });
    expect(decode(payload)).toEqual({
      iss: "TEAM123456",
      iat: now / 1000,
      exp: now / 1000 + MAPKIT_TOKEN_TTL_SECONDS,
      origin: "https://dayframe-staging.vercel.app"
    });
    expect(expiresAt).toBe(now + MAPKIT_TOKEN_TTL_SECONDS * 1000);
    expect(verify("sha256", Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))).toBe(true);
  });
});
