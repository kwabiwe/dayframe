import * as ExpoLinking from "expo-linking";
import { enqueueEvent } from "./api";

type ShortcutQuery = Record<string, string | string[] | undefined>;

export async function handleDayframeUrl(url: string) {
  const parsed = ExpoLinking.parse(url);
  const action = normalizeAction(parsed);
  return enqueueShortcutAction(action, parsed.queryParams ?? {}, { url });
}

export async function enqueueShortcutAction(
  action: string | undefined,
  query: ShortcutQuery,
  rawPayload: Record<string, unknown> = {}
) {
  const projectId = firstString(query.projectId);
  const categoryId = firstString(query.categoryId);

  if (action === "action/start" && projectId) {
    return enqueueEvent({
      source: "shortcut",
      type: "shortcut_action",
      projectId,
      categoryId,
      rawPayload
    });
  }

  if (action === "action/stop") {
    return enqueueEvent({
      source: "shortcut",
      type: "timer_stop",
      rawPayload
    });
  }

  return null;
}

function normalizeAction(parsed: ReturnType<typeof ExpoLinking.parse>) {
  const host = (parsed as { hostname?: unknown }).hostname;
  const pathValue = parsed.path;
  const path = Array.isArray(pathValue) ? pathValue.join("/") : pathValue;

  return [typeof host === "string" ? host : undefined, path]
    .filter((part): part is string => Boolean(part))
    .join("/");
}

function firstString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
