// @vitest-environment jsdom

import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { ReportBlockRow } from "./ReportDetailsTable";
import { formatDate, formatTime } from "@/lib/format";

type RowEntry = Parameters<typeof ReportBlockRow>[0]["entry"];

const entry = {
  id: "entry-1",
  description: "Quarterly report",
  categoryId: null,
  categoryName: null,
  categoryColor: null,
  tagNames: [],
  placeName: null,
  startedAt: "2026-10-12T11:16:00.000Z",
  stoppedAt: "2026-10-12T12:19:00.000Z",
  durationSeconds: 3780,
  isRunning: false,
  overlapCount: 0,
  overlapSeconds: 0
} as unknown as RowEntry;

function row() {
  return (
    <ul>
      <ReportBlockRow disabled={false} entry={entry} icon={null} onEdit={() => {}} />
    </ul>
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Reports block row hydration (React #418)", () => {
  it("leaves the browser-local date and clock time out of the server HTML", () => {
    const html = renderToString(row());
    expect(html).not.toMatch(/\d{2}:\d{2}/);
    expect(html).not.toContain(formatDate(entry.startedAt));
    expect(html).toContain("Quarterly report");
  });

  it("hydrates without a mismatch, then shows the local date and time range", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(row());
    document.body.append(container);
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, row(), { onRecoverableError: (error) => errors.push(error) });
    });
    expect(errors).toEqual([]);
    const when = `${formatTime(entry.startedAt, "24h")}–${formatTime(entry.stoppedAt!, "24h")}`;
    expect(container.textContent).toContain(when);
    expect(container.textContent).toContain(formatDate(entry.startedAt));
    expect(container.querySelector(".df-erow-main")?.getAttribute("aria-label")).toContain(when);
  });
});
