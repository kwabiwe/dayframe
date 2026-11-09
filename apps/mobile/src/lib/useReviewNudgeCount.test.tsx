import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../node_modules/react/index.js");
});
const note = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./reviewNudge", () => ({ noteReviewCount: note }));

import { useReviewNudgeCount } from "./useReviewNudgeCount";

const owner = { userId: "user-a", workspaceId: "ws-1" };
type Props = { owner: typeof owner | null; count: number; dayKey: string; foreground: boolean };
function Probe({ owner: who, count, dayKey, foreground }: Props) {
  useReviewNudgeCount(who, count, { dayKey, foreground });
  return null;
}
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

describe("the evening reminder's count (owner item 13; Codex r1 on #610)", () => {
  it("notes the same count again on each return to the front and each new day, so the one-shot reminder is renewed", async () => {
    note.mockClear();
    let tree!: ReturnType<typeof create>;
    const props: Props = { owner, count: 3, dayKey: "2026-10-28", foreground: true };
    act(() => { tree = create(<Probe {...props} />); });
    await flush();
    expect(note).toHaveBeenCalledTimes(1);
    expect(note).toHaveBeenLastCalledWith(owner, 3);
    // A render with nothing new (a new owner object for the same account) notes nothing.
    act(() => { tree.update(<Probe {...props} owner={{ ...owner }} />); });
    await flush();
    expect(note).toHaveBeenCalledTimes(1);
    // Away and back: noted again with the same count.
    act(() => { tree.update(<Probe {...props} foreground={false} />); });
    await flush();
    expect(note).toHaveBeenCalledTimes(1);
    act(() => { tree.update(<Probe {...props} />); });
    await flush();
    expect(note).toHaveBeenCalledTimes(2);
    // The next day, same count: noted again.
    act(() => { tree.update(<Probe {...props} dayKey="2026-10-29" />); });
    await flush();
    expect(note).toHaveBeenCalledTimes(3);
    expect(note).toHaveBeenLastCalledWith(owner, 3);
  });

  it("notes nothing while signed out", async () => {
    note.mockClear();
    act(() => { create(<Probe count={2} dayKey="2026-10-28" foreground owner={null} />); });
    await flush();
    expect(note).not.toHaveBeenCalled();
  });
});
