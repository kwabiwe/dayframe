import { createPrivateKey, sign, type KeyObject } from "node:crypto";

/**
 * Apple MapKit JS tokens for the web map (UI review, owner 29 Oct 2026): a short-lived ES256 JWT signed on the
 * server with the MapKit JS key from Vercel (`MAPKIT_JS_TEAM_ID`, `MAPKIT_JS_KEY_ID`, `MAPKIT_JS_PRIVATE_KEY`),
 * locked to the page's own origin. The key never leaves the server. Without all three variables the web keeps its
 * current map.
 */
export const MAPKIT_TOKEN_TTL_SECONDS = 30 * 60;

export type MapKitConfig = { teamId: string; keyId: string; privateKey: KeyObject };

let cached: { source: string; config: MapKitConfig | null } | null = null;

/** The configured MapKit JS key, or null when any variable is missing or the key can't be read. */
export function mapKitConfig(env: Record<string, string | undefined> = process.env): MapKitConfig | null {
  const teamId = env.MAPKIT_JS_TEAM_ID?.trim() ?? "";
  const keyId = env.MAPKIT_JS_KEY_ID?.trim() ?? "";
  // Hosted environments may store the .p8 as one line with escaped newlines.
  const pem = (env.MAPKIT_JS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
  const source = `${teamId}\u0000${keyId}\u0000${pem}`;
  if (cached?.source === source) return cached.config;
  let config: MapKitConfig | null = null;
  if (teamId && keyId && pem) {
    try {
      config = { teamId, keyId, privateKey: createPrivateKey({ key: pem, format: "pem" }) };
    } catch {
      config = null;
    }
  }
  cached = { source, config };
  return config;
}

const base64Url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

/** A MapKit JS token for one origin, valid for `MAPKIT_TOKEN_TTL_SECONDS`. */
export function signMapKitToken(config: MapKitConfig, origin: string, nowMs = Date.now()) {
  const issuedAt = Math.floor(nowMs / 1000);
  const header = { alg: "ES256", kid: config.keyId, typ: "JWT" };
  const payload = { iss: config.teamId, iat: issuedAt, exp: issuedAt + MAPKIT_TOKEN_TTL_SECONDS, origin };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  // JWS wants the raw r || s signature, not DER.
  const signature = sign("sha256", Buffer.from(signingInput), { key: config.privateKey, dsaEncoding: "ieee-p1363" });
  return { token: `${signingInput}.${base64Url(signature)}`, expiresAt: (issuedAt + MAPKIT_TOKEN_TTL_SECONDS) * 1000 };
}
