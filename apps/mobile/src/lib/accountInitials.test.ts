import { describe, expect, it } from "vitest";
import { accountInitials } from "./accountInitials";

describe("accountInitials", () => {
  it("uses up to two initials from the name", () => {
    expect(accountInitials("Demo User", "x@y.z")).toBe("DU");
    expect(accountInitials("  ada  lovelace byron ", null)).toBe("AL");
    expect(accountInitials("Émile", null)).toBe("É");
  });
  it("falls back to the email's first letter, then nothing", () => {
    expect(accountInitials("", "kay@example.com")).toBe("K");
    expect(accountInitials(null, null)).toBe("");
  });
});
