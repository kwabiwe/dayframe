// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TimeField } from "./TimeField";

afterEach(cleanup);

function Harness({ clock = "24h" as const, initial = "12:35" }: { clock?: "24h" | "12h"; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <TimeField clock={clock} label="Start time" onChange={setValue} value={value} />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe("TimeField", () => {
  it("is a text field, never the browser's time picker", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Start time").getAttribute("type")).toBe("text");
  });

  it("reads what is typed on blur with the shared parser", () => {
    render(<Harness />);
    const field = screen.getByLabelText("Start time");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "930" } });
    fireEvent.blur(field);
    expect(screen.getByTestId("value").textContent).toBe("09:30");
  });

  it("goes back to the last good time when it can't read what was typed", () => {
    render(<Harness />);
    const field = screen.getByLabelText("Start time") as HTMLInputElement;
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "99" } });
    fireEvent.blur(field);
    expect(screen.getByTestId("value").textContent).toBe("12:35");
    expect(field.value).toBe("12:35");
  });

  it("shows the time in the 12-hour clock and reads AM/PM", () => {
    render(<Harness clock="12h" initial="21:30" />);
    const field = screen.getByLabelText("Start time") as HTMLInputElement;
    expect(field.value).toBe("9:30 PM");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "8:15 am" } });
    fireEvent.blur(field);
    expect(screen.getByTestId("value").textContent).toBe("08:15");
  });
});
