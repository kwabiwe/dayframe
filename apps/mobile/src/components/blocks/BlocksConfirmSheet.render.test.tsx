import { act, create, type ReactTestInstance } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const mocks = vi.hoisted(() => ({
  keyboardDismiss: vi.fn(),
  sheetProps: [] as Record<string, unknown>[]
}));
vi.mock("react-native", () => ({
  Keyboard: { dismiss: () => mocks.keyboardDismiss() },
  Modal: "Modal",
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(value: T) => value },
  Text: "Text",
  View: "View"
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 0 }) }));
vi.mock("../SwipeDismissSheet", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  const React = await import("../../../../../node_modules/react/index.js");
  return {
    // The real sheet springs out, then calls onDismiss; the mock leaves at once.
    SwipeDismissSheet: React.forwardRef((props: { children: unknown; onDismiss: () => void; onDismissStart?: () => void }, ref: unknown) => {
      mocks.sheetProps.push(props as never);
      React.useImperativeHandle(ref, () => ({
        dismiss: () => {
          props.onDismissStart?.();
          props.onDismiss();
        }
      }));
      return React.createElement("Sheet", null, props.children);
    })
  };
});
vi.mock("../../lib/mobileTypography", () => ({ MOBILE_DISPLAY_FONT: { bold: "Display" }, mobileTextProps: () => ({}) }));

const { BlocksConfirmHost, BlocksConfirmSheet, useBlocksConfirm } = await import("./BlocksConfirmSheet");
type Controller = ReturnType<typeof useBlocksConfirm>;

const theme = {
  background: "bg", danger: "danger", onDanger: "onDanger", surfaceMuted: "muted", textMuted: "textMuted",
  textPrimary: "primary", textSecondary: "secondary"
} as never;
const styles = { activeEditSheet: {}, sheetBackdrop: {}, sheetHandle: {}, sheetOverlay: {} } as never;

let tree: ReturnType<typeof create> | undefined;
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
  mocks.sheetProps.length = 0;
  mocks.keyboardDismiss.mockReset();
});

function render(overrides: Record<string, unknown> = {}, reduceMotion = false) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const onClosed = vi.fn();
  const request = {
    eyebrow: "Location history",
    title: "Clear recent location history?",
    message: "Logged blocks stay.",
    confirmLabel: "Clear history",
    onCancel,
    onConfirm,
    ...overrides
  };
  act(() => {
    tree = create(
      <BlocksConfirmSheet onClosed={onClosed} reduceMotion={reduceMotion} request={request as never} styles={styles} theme={theme} />
    );
  });
  return { onCancel, onClosed, onConfirm };
}
const byTestId = (id: string) => tree!.root.find((node: ReactTestInstance) => node.props.testID === id && typeof node.type === "string");
const texts = () => tree!.root.findAll((node: ReactTestInstance) => (node.type as unknown) === "Text").map((node) => node.children.join(""));
const modalView = () => tree!.root.find((node: ReactTestInstance) => (node.type as unknown) === "View" && node.props.accessibilityViewIsModal === true);
const flatStyle = (node: ReactTestInstance) => {
  const style = typeof node.props.style === "function" ? node.props.style({ pressed: false }) : node.props.style;
  return Object.assign({}, ...[style].flat(3).filter(Boolean));
};

describe("BlocksConfirmSheet", () => {
  it("shows an eyebrow, a title, a short body, Cancel and the danger pill", () => {
    render();
    expect(texts()).toEqual(["LOCATION HISTORY", "Clear recent location history?", "Logged blocks stay.", "Cancel", "Clear history"]);
    const title = tree!.root.find((node: ReactTestInstance) => (node.type as unknown) === "Text" && node.props.accessibilityRole === "header");
    expect(title.children.join("")).toBe("Clear recent location history?");
    expect(flatStyle(byTestId("blocks-confirm-sheet-confirm")).backgroundColor).toBe("danger");
    expect(flatStyle(byTestId("blocks-confirm-sheet-cancel")).backgroundColor).toBe("muted");
  });

  it("keeps both actions at least 44 points tall and named as buttons", () => {
    render();
    for (const id of ["blocks-confirm-sheet-confirm", "blocks-confirm-sheet-cancel"]) {
      const pill = byTestId(id);
      expect(pill.props.accessibilityRole).toBe("button");
      expect(flatStyle(pill).minHeight).toBeGreaterThanOrEqual(44);
    }
    expect(byTestId("blocks-confirm-sheet-confirm").props.accessibilityHint).toBe("This can't be undone.");
  });

  it("is modal for VoiceOver, and escape, the system close and the backdrop are Cancel", () => {
    const { onCancel, onConfirm } = render();
    expect(modalView().props.accessibilityViewIsModal).toBe(true);
    act(() => modalView().props.onAccessibilityEscape());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(mocks.sheetProps.at(-1)?.backdropAccessibilityLabel).toBe("Cancel");
    const modal = tree!.root.find((node: ReactTestInstance) => (node.type as unknown) === "Modal");
    expect(modal.props.animationType).toBe("none");
    expect(typeof modal.props.onRequestClose).toBe("function");
  });

  it("treats a swipe down or backdrop dismissal as Cancel", () => {
    const { onCancel, onClosed, onConfirm } = render();
    const props = mocks.sheetProps.at(-1) as { onDismiss: () => void; onDismissStart: () => void };
    act(() => {
      props.onDismissStart();
      props.onDismiss();
    });
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms once however fast the danger pill is tapped, after the sheet has left", () => {
    const { onCancel, onClosed, onConfirm } = render();
    act(() => {
      const pill = byTestId("blocks-confirm-sheet-confirm");
      pill.props.onPress();
      pill.props.onPress();
      byTestId("blocks-confirm-sheet-cancel").props.onPress();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onClosed.mock.invocationCallOrder[0]).toBeLessThan(onConfirm.mock.invocationCallOrder[0]);
  });

  it("hands Reduce Motion to the one sheet owner (its fade path) and dismisses the keyboard underneath", () => {
    render({}, true);
    expect(mocks.sheetProps.at(-1)?.reduceMotion).toBe(true);
    expect(mocks.keyboardDismiss).toHaveBeenCalled();
  });

  it("uses an inverse neutral pill for a reversible action and a custom cancel label", () => {
    render({ cancelLabel: "Keep editing", tone: "neutral" });
    expect(texts()).toContain("Keep editing");
    expect(flatStyle(byTestId("blocks-confirm-sheet-confirm")).backgroundColor).toBe("primary");
    expect(byTestId("blocks-confirm-sheet-confirm").props.accessibilityHint).toBeUndefined();
  });
});

describe("useBlocksConfirm", () => {
  function Harness({ onController }: { onController: (controller: Controller) => void }) {
    const controller = useBlocksConfirm();
    onController(controller);
    return <BlocksConfirmHost controller={controller} reduceMotion={false} styles={styles} theme={theme} />;
  }

  it("shows one confirmation at a time and frees the slot once it has left", () => {
    let controller!: Controller;
    act(() => {
      tree = create(<Harness onController={(value) => { controller = value; }} />);
    });
    const first = vi.fn();
    const second = vi.fn();
    let shown: boolean[] = [];
    act(() => {
      shown = [
        controller.confirm({ eyebrow: "A", title: "First?", message: "", confirmLabel: "Go", onConfirm: first }),
        controller.confirm({ eyebrow: "B", title: "Second?", message: "", confirmLabel: "Go", onConfirm: second })
      ];
    });
    expect(shown).toEqual([true, false]);
    expect(texts()).toContain("First?");
    act(() => byTestId("blocks-confirm-sheet-confirm").props.onPress());
    expect(first).toHaveBeenCalledTimes(1);
    expect(texts()).toEqual([]);
    act(() => {
      shown = [controller.confirm({ eyebrow: "B", title: "Second?", message: "", confirmLabel: "Go", onConfirm: second })];
    });
    expect(shown).toEqual([true]);
    expect(texts()).toContain("Second?");
  });
});
