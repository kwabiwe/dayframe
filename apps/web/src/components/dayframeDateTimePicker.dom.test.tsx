// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DayframeDateTimePicker } from "./DayframeDateTimePicker";

describe("DayframeDateTimePicker", () => {
  afterEach(cleanup);

  it("accepts compact HHMM typing in the Add Time control", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DayframeDateTimePicker
        compact
        defaultValue="2026-08-13T09:00"
        id="manual-entry-start"
        name="startedAt"
        onChange={onChange}
      />
    );

    await user.click(screen.getByRole("button", { name: /Choose date and time, currently/ }));
    const input = screen.getByLabelText("Time") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "1025");
    expect(input.value).toBe("1025");
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenLastCalledWith("2026-08-13T10:25");
    expect(screen.getByRole("button", { name: /currently/ }).textContent).toContain("10:25");
  });

  it("keeps the compact value time-only while preserving its accessible date and cross-midnight offset", () => {
    render(
      <DayframeDateTimePicker
        compact
        dayOffset={1}
        defaultValue="2026-08-14T00:30"
        id="manual-entry-finish"
        label="Finish"
        name="stoppedAt"
      />
    );

    const trigger = screen.getByRole("button", { name: /Finish date and time, currently .*one day after Start/ });
    expect(trigger.textContent).toContain("00:30");
    expect(trigger.textContent).not.toContain("14 Aug");
    expect(trigger.textContent).toContain("+1");
  });
});
