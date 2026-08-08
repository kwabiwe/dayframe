export async function probeMetroStatus(port, fetchImplementation = fetch) {
  try {
    const response = await fetchImplementation(`http://127.0.0.1:${port}/status`, {
      signal: AbortSignal.timeout(1_000)
    });
    return response.ok && (await response.text()).includes("packager-status:running");
  } catch {
    return false;
  }
}

export function assertDedicatedMetroPortAvailable({ port, ready }) {
  if (ready) {
    throw new Error(
      `Metro port ${port} is already serving a packager. Choose an unused dedicated port so the QA runner can prove the bundle belongs to this worktree.`
    );
  }
}

export function verifySourceProvenanceUnchanged(initial, current) {
  for (const key of ["revision", "fingerprint", "dirty"]) {
    if (initial?.[key] !== current?.[key]) {
      throw new Error(
        `The source changed during native QA (${key}: ${JSON.stringify(initial?.[key])} != ${JSON.stringify(current?.[key])}).`
      );
    }
  }
  return true;
}

export function verifyBuildManifest(manifest, expected) {
  if (!manifest || manifest.schemaVersion !== 1) {
    throw new Error("The reused build has no supported Dayframe QA provenance manifest.");
  }
  for (const key of [
    "appBundlePath",
    "scheme",
    "sourceFingerprint",
    "sourceRevision",
    "workspacePath",
    "xctestrunPath"
  ]) {
    if (manifest[key] !== expected[key]) {
      throw new Error(
        `The reused build provenance does not match ${key}: ${JSON.stringify(manifest[key])} != ${JSON.stringify(expected[key])}.`
      );
    }
  }
  return true;
}
