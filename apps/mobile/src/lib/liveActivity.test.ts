import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn()
}));

vi.mock("react-native", () => ({
  NativeModules: {
    DayframeLiveActivityModule: {
      start: mocks.start,
      stop: mocks.stop
    }
  },
  Platform: { OS: "ios" }
}));

async function loadModule() {
  vi.resetModules();
  return import("./liveActivity");
}

describe("Live Activity sync", () => {
  beforeEach(() => {
    mocks.start.mockReset();
    mocks.start.mockResolvedValue(true);
    mocks.stop.mockReset();
    mocks.stop.mockResolvedValue(true);
  });

  it("clears stale native activities on the first idle bootstrap", async () => {
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry(null);

    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it("starts a native activity for a changed active entry", async () => {
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry({
      id: "entry-1",
      startedAt: "2026-07-12T06:45:00.000Z",
      description: "School run",
      categoryName: "Family",
      categoryColor: "violet"
    });
    await syncLiveActivityForEntry({
      id: "entry-1",
      startedAt: "2026-07-12T06:45:00.000Z",
      description: "School run",
      categoryName: "Family",
      categoryColor: "violet"
    });

    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.start).toHaveBeenCalledWith(
      "School run",
      "Family",
      "#8D63E6",
      "2026-07-12T06:45:00.000Z"
    );
  });

  it("retries active-entry reconciliation when native start reports failure", async () => {
    mocks.start
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { syncLiveActivityForEntry } = await loadModule();
    const entry = {
      id: "entry-1",
      startedAt: "2026-07-12T06:45:00.000Z",
      description: "School run",
      categoryName: "Family",
      categoryColor: "violet"
    };

    await syncLiveActivityForEntry(entry);
    await syncLiveActivityForEntry(entry);

    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  it("retries idle reconciliation when native stop reports failure", async () => {
    mocks.stop
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry(null);
    await syncLiveActivityForEntry(null);

    expect(mocks.stop).toHaveBeenCalledTimes(2);
  });
});
