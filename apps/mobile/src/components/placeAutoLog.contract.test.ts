import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Per-place "Log automatically" (owner decision 14 Oct 2026): a switch in the Places editor's Visits
// group, choosable only with Suggest visits here on, off by default, with a caution for Home.
const editor = readFileSync(fileURLToPath(new URL("../../app/place-editor.tsx", import.meta.url)), "utf8");

describe("Places editor Log automatically", () => {
  it("is a switch under Suggest visits here, disabled while visits aren't suggested", () => {
    expect(editor).toContain('title="Log automatically"');
    expect(editor).toContain('subtitle="Visits here become blocks without asking in Calendar."');
    expect(editor).toContain("disabled={!loggingEnabled}");
    expect(editor).toContain("value={loggingEnabled && autoLog}");
    // Turning Suggest visits off turns it off too.
    expect(editor).toMatch(/if \(!enabled\) \{\s*setAutoLog\(false\);/);
  });

  it("starts off, loads the saved value and saves it only with logging on", () => {
    expect(editor).toContain("const [autoLog, setAutoLog] = useState(false);");
    expect(editor).toContain("setAutoLog(place.loggingEnabled !== false && place.autoLog === true);");
    expect((editor.match(/autoLog: loggingEnabled && autoLog,/g) ?? []).length).toBe(2);
  });

  it("cautions a Home place but still allows it", () => {
    expect(editor).toContain('{placeRole === "home" ? (');
    expect(editor).toContain("Home visits can be long and broad; consider leaving this off.");
  });
});
