import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  Text: "Text",
  View: "View"
}));

vi.mock("@/lib/mobileTheme", () => ({
  pressable: (...styles: unknown[]) => styles.filter(Boolean)
}));

import { TimerStopIssueActions } from "./TimerStopIssueActions";

const styles = {
  buttonPressed: {},
  buttonRow: {},
  secondaryButton: {},
  secondaryButtonText: {}
} as never;

describe("Timer Stop diagnostics actions", () => {
  it("renders Retry and Discard actions that target only their rejected Stop", () => {
    const retry = vi.fn();
    const discard = vi.fn();
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(
        <TimerStopIssueActions
          clientEventId="stop-client-event-1"
          onDiscard={discard}
          onRetry={retry}
          styles={styles}
        />
      );
    });

    const retryButton = tree.root.findByProps({
      accessibilityLabel: "Retry rejected timer Stop"
    });
    const discardButton = tree.root.findByProps({
      accessibilityLabel: "Discard rejected timer Stop"
    });
    expect(retryButton.props.accessibilityRole).toBe("button");
    expect(discardButton.props.accessibilityRole).toBe("button");
    expect(tree.root.findByProps({ children: "Retry Stop" })).toBeDefined();
    expect(tree.root.findByProps({ children: "Discard Stop" })).toBeDefined();

    act(() => retryButton.props.onPress());
    act(() => discardButton.props.onPress());

    expect(retry).toHaveBeenCalledExactlyOnceWith("stop-client-event-1");
    expect(discard).toHaveBeenCalledExactlyOnceWith("stop-client-event-1");
  });
});
