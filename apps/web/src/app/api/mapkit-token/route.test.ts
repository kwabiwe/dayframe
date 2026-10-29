import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/session";

const mocks = vi.hoisted(() => ({ resolveRequestSession: vi.fn() }));
vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: mocks.resolveRequestSession }));

const { GET } = await import("./route");
const pem = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const decodePayload = (token: string) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));

describe("/api/mapkit-token", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed without a session, before reading the key", async () => {
    vi.stubEnv("MAPKIT_JS_TEAM_ID", "TEAM123456");
    vi.stubEnv("MAPKIT_JS_KEY_ID", "KEY1234567");
    vi.stubEnv("MAPKIT_JS_PRIVATE_KEY", pem);
    mocks.resolveRequestSession.mockRejectedValue(new AuthError("Unauthorized", 401));
    const response = await GET(new Request("https://dayframe.test/api/mapkit-token"));
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).not.toContain("token");
  });

  it("says MapKit isn't configured when a variable is missing", async () => {
    vi.stubEnv("MAPKIT_JS_TEAM_ID", "");
    vi.stubEnv("MAPKIT_JS_KEY_ID", "");
    vi.stubEnv("MAPKIT_JS_PRIVATE_KEY", "");
    const response = await GET(new Request("https://dayframe.test/api/mapkit-token"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ available: false });
  });

  it("returns a private token locked to the request's origin, never the key", async () => {
    vi.stubEnv("MAPKIT_JS_TEAM_ID", "TEAM123456");
    vi.stubEnv("MAPKIT_JS_KEY_ID", "KEY1234567");
    vi.stubEnv("MAPKIT_JS_PRIVATE_KEY", pem);
    const response = await GET(new Request("https://dayframe-staging.vercel.app/api/mapkit-token"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body.available).toBe(true);
    expect(decodePayload(body.token).origin).toBe("https://dayframe-staging.vercel.app");
    expect(JSON.stringify(body)).not.toContain("PRIVATE KEY");
  });
});
