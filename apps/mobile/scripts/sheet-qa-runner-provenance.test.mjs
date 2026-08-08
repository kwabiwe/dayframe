import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  assertDedicatedMetroPortAvailable,
  probeMetroStatus,
  verifyBuildManifest,
  verifySourceProvenanceUnchanged
} from "./sheet-qa-runner-provenance.mjs";

describe("sheet QA runner provenance", () => {
  it("rejects an already-running Metro sentinel instead of accepting another worktree", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("packager-status:running");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test server address.");
      const ready = await probeMetroStatus(address.port);
      expect(ready).toBe(true);
      expect(() => assertDedicatedMetroPortAvailable({ port: address.port, ready }))
        .toThrow(/already serving a packager/);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("rejects a reusable native product built from another source fingerprint", () => {
    const expected = {
      appBundlePath: "/tmp/Dayframe.app",
      scheme: "DayframeSheetQA",
      sourceFingerprint: "current",
      sourceRevision: "abc123",
      workspacePath: "/repo/apps/mobile/ios/Dayframe.xcworkspace",
      xctestrunPath: "/tmp/DayframeSheetQA.xctestrun"
    };
    expect(() => verifyBuildManifest({
      schemaVersion: 1,
      ...expected,
      sourceFingerprint: "stale"
    }, expected)).toThrow(/sourceFingerprint/);
    expect(verifyBuildManifest({ schemaVersion: 1, ...expected }, expected)).toBe(true);
  });

  it("rejects source changes during a native evidence run", () => {
    const initial = { dirty: false, fingerprint: "source-a", revision: "abc123" };
    expect(verifySourceProvenanceUnchanged(initial, { ...initial })).toBe(true);
    expect(() => verifySourceProvenanceUnchanged(initial, {
      ...initial,
      fingerprint: "source-b"
    })).toThrow(/source changed during native QA.*fingerprint/i);
    expect(() => verifySourceProvenanceUnchanged(initial, {
      ...initial,
      dirty: true
    })).toThrow(/source changed during native QA.*dirty/i);
  });
});
