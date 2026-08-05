// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineTagInput } from "./InlineTagInput";

const styles = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

describe("InlineTagInput rendered geometry", () => {
  afterEach(() => {
    cleanup();
    document.head.querySelector("[data-inline-tag-test-styles]")?.remove();
    document.body.innerHTML = "";
  });

  it("centres visible and measured labels while offsetting only the remove X", () => {
    installInlineTagStyles();
    render(createElement(InlineTagInput, {
      ariaLabel: "Task description",
      onChange: vi.fn(),
      onSelectedTagNamesChange: vi.fn(),
      selectedTagNames: ["Planning"],
      tags: [{ id: "planning", name: "Planning", normalizedName: "planning", usageCount: 1 }],
      value: "Plan release"
    }));

    const target = screen.getByRole("button", { name: "Remove tag Planning" });
    const visible = target.querySelector<HTMLElement>(".inline-selected-tag-visual") as HTMLElement;
    const visibleLabel = visible.querySelector<HTMLElement>(":scope > span") as HTMLElement;
    const visibleIcon = visible.querySelector<SVGElement>(":scope > svg") as SVGElement;
    const measured = document.querySelector<HTMLElement>("[data-tag-measure]") as HTMLElement;
    const measuredIcon = measured.querySelector<SVGElement>(":scope > svg") as SVGElement;

    expect(getComputedStyle(visible).alignItems).toBe("center");
    expect(getComputedStyle(measured).alignItems).toBe("center");
    expect(getComputedStyle(visibleIcon).position).toBe("relative");
    expect(getComputedStyle(visibleIcon).top).toBe("1px");
    expect(getComputedStyle(measuredIcon).position).toBe("relative");
    expect(getComputedStyle(measuredIcon).top).toBe("1px");
    expect(getComputedStyle(visibleLabel).position).not.toBe("relative");
    expect(getComputedStyle(visibleLabel).top).not.toBe("1px");
  });
});

function installInlineTagStyles() {
  const style = document.createElement("style");
  style.dataset.inlineTagTestStyles = "true";
  style.textContent = [
    cssBlock(".inline-tag-input-anchor {"),
    cssBlock(".inline-selected-tag,\n.inline-selected-tag-overflow {"),
    cssBlock(".inline-selected-tag-visual,\n.inline-selected-tag-overflow-visual {"),
    cssBlock(".inline-selected-tag-visual > svg {")
  ].join("\n");
  document.head.append(style);
}

function cssBlock(selector: string) {
  const start = styles.indexOf(selector);
  if (start < 0) throw new Error(`Missing CSS selector: ${selector}`);
  const end = styles.indexOf("}", start);
  if (end < 0) throw new Error(`Unclosed CSS selector: ${selector}`);
  return styles.slice(start, end + 1);
}
