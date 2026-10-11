import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const layout = readFileSync(resolve(__dirname, "layout.tsx"), "utf8");
const login = readFileSync(resolve(__dirname, "../login/page.tsx"), "utf8");
const authForm = readFileSync(resolve(__dirname, "../../components/AuthForm.tsx"), "utf8");

describe("Settings for a visitor without a session", () => {
  it("signs in first and comes back to Settings (the iPhone's web and export rows)", () => {
    expect(layout).toContain('if (!isAuthenticatedPageSession(session)) redirect("/login?next=%2Fsettings");');
    expect(login).toContain("const next = safeNextPath((await searchParams).next);");
    expect(login).toContain('if (session) redirect(next ?? "/");');
    expect(login).toContain('<AuthForm mode="login" next={next} />');
    expect(authForm).toContain('window.location.replace(next ? `${next}${window.location.hash}` : "/");');
  });
});
