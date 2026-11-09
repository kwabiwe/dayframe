import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => ({
  params: {} as { check?: string },
  setParams: vi.fn(),
  openCheckLink: vi.fn() as ((check: string) => void) | undefined
}));
vi.mock("expo-router", () => ({
  router: { setParams: (next: { check?: string }) => { mocks.setParams(next); mocks.params = { ...mocks.params, ...next }; } },
  useLocalSearchParams: () => mocks.params
}));
vi.mock("@/components/DayframeDashboard", () => ({
  DayframeDashboardScreen: () => null,
  useDashboardOpenCheckLink: () => mocks.openCheckLink
}));
vi.mock("@/lib/nativeTabs", () => ({ DAYFRAME_NATIVE_TABS: { calendar: { dashboardTab: "calendar" } } }));

const ID = "30000000-0000-4000-8000-000000000001";

describe("old Review links reach the Calendar tab (step 15)", () => {
  beforeEach(() => {
    mocks.params = {};
    mocks.setParams.mockClear();
    mocks.openCheckLink = vi.fn();
  });

  it("redirects a cold or warm dayframe://review link to the Calendar tab's check request, leaving other links alone", async () => {
    const { redirectSystemPath } = await import("../../../app/+native-intent");
    expect(redirectSystemPath({ path: `dayframe://review/${ID}`, initial: true })).toBe(`/calendar?check=${ID}`);
    expect(redirectSystemPath({ path: "dayframe://review", initial: false })).toBe("/calendar?check=first");
    expect(redirectSystemPath({ path: "dayframe://action/stop", initial: true })).toBe("dayframe://action/stop");
  });

  it("hands the tab's check to the Dashboard once and clears it, so the same link opens it again", async () => {
    const { default: CalendarScreen } = await import("../../../app/(tabs)/calendar");
    mocks.params = { check: ID };
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<CalendarScreen />); });
    expect(mocks.openCheckLink).toHaveBeenCalledWith(ID);
    expect(mocks.setParams).toHaveBeenCalledWith({ check: undefined });
    act(() => tree.update(<CalendarScreen />));
    expect(mocks.openCheckLink).toHaveBeenCalledOnce();
    // The same link again (warm): a new check parameter, opened again.
    mocks.params = { check: ID };
    act(() => tree.update(<CalendarScreen />));
    expect(mocks.openCheckLink).toHaveBeenCalledTimes(2);
  });

  it("keeps the check until the Dashboard can take it (the provider not mounted yet)", async () => {
    const { default: CalendarScreen } = await import("../../../app/(tabs)/calendar");
    mocks.params = { check: "first" };
    const open = vi.fn();
    mocks.openCheckLink = undefined;
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<CalendarScreen />); });
    expect(mocks.setParams).not.toHaveBeenCalled();
    mocks.openCheckLink = open;
    act(() => tree.update(<CalendarScreen />));
    expect(open).toHaveBeenCalledWith("first");
  });
});
