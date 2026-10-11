import { act, create, type ReactTestInstance } from "react-test-renderer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("react-native", () => ({
  Modal: "Modal",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: <T,>(value: T) => value },
  Text: "Text",
  View: "View",
  useWindowDimensions: () => ({ fontScale: 1, height: 667, width: 320 })
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 0 }) }));
vi.mock("../icons/DayframeIcon", () => ({ DayframeIcon: "Icon" }));
vi.mock("../SwipeDismissSheet", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  const React = await import("../../../../../node_modules/react/index.js");
  return {
    SwipeDismissSheet: React.forwardRef((props: { children: unknown; onDismiss: () => void }, ref: unknown) => {
      React.useImperativeHandle(ref, () => ({ dismiss: () => props.onDismiss() }));
      return React.createElement("Sheet", props, props.children);
    })
  };
});
vi.mock("../../lib/mobileTypography", () => ({ MOBILE_DISPLAY_FONT: { bold: "Display" }, mobileTextProps: () => ({}) }));

const { BlocksInfoSheet } = await import("./BlocksInfoSheet");

const theme = {
  surfaceInset: "inset", surfaceMuted: "muted", textMuted: "textMuted", textPrimary: "primary", textSecondary: "secondary"
} as never;
const styles = { activeEditSheet: {}, sheetBackdrop: {}, sheetHandle: {}, sheetOverlay: {} } as never;

let tree: ReturnType<typeof create> | undefined;
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
});

function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
}

describe("BlocksInfoSheet (UIA-022)", () => {
  it("shows the eyebrow, title, icon rows and privacy note, and Done closes it", () => {
    const onClose = vi.fn();
    act(() => {
      tree = create(
        <BlocksInfoSheet
          eyebrow="Location"
          note={{ glyph: "shield", text: "Private note." }}
          onClose={onClose}
          reduceMotion
          rows={[
            { glyph: "inbox", lead: "First.", text: "One." },
            { glyph: "check", lead: "Second.", text: "Two." }
          ]}
          styles={styles}
          testID="info"
          theme={theme}
          title="How suggestions work"
        />
      );
    });
    const root = tree!.root;
    const texts = root.findAllByType("Text" as never).map(text);
    expect(texts).toContain("LOCATION");
    expect(texts).toContain("How suggestions work");
    expect(texts).toContain("First. One.");
    expect(texts).toContain("Private note.");
    const done = root.findByProps({ testID: "info-done" });
    expect(done.props.accessibilityRole).toBe("button");
    expect(done.props.style({ pressed: false })).toEqual(expect.arrayContaining([expect.objectContaining({ minHeight: 44 })]));
    act(() => done.props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Learned place suggestion sheet wording (UIA-031)", () => {
  const source = readFileSync(fileURLToPath(new URL("../../../app/places.tsx", import.meta.url)), "utf8");
  it("uses plain labels and no progress bar", () => {
    for (const old of ["Resolved name / POI", "Dwell evidence", "\"Samples\"", "Address/postcode", "SheetMutationProgress", "Ignoring...", "Forgetting..."]) {
      expect(source).not.toContain(old);
    }
    for (const label of ["PLACE SUGGESTION", "title=\"Address\"", "title=\"Visits seen\"", "title=\"Time spent here\"", "Ignoring…", "Forgetting…"]) {
      expect(source).toContain(label);
    }
  });
});
