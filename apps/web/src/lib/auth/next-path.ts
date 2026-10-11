/**
 * A same-site path to return to after signing in (`/login?next=/settings`), or null. Only a plain
 * absolute path is accepted, never another origin, a protocol-relative URL or a backslash trick.
 */
export function safeNextPath(value: string | string[] | null | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || raw.length > 512) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  try {
    const parsed = new URL(raw, "https://dayframe.invalid");
    if (parsed.origin !== "https://dayframe.invalid") return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}
