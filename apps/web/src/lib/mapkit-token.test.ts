import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
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
