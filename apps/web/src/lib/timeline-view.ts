export type TimelineView = "calendar" | "list" | "timesheet";

export function timelineViewFromSearchParams(params: Pick<URLSearchParams, "get">): TimelineView {
  const value = params.get("view");
  return value === "list" || value === "timesheet" ? value : "calendar";
}

export function timelineSearchWithView(search: string, view: TimelineView) {
  const params = new URLSearchParams(search);
  if (view === "calendar") params.delete("view");
  else params.set("view", view);
  const query = params.toString();
  return query ? `/timeline?${query}` : "/timeline";
}
