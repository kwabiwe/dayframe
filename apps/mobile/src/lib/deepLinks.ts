import * as ExpoLinking from "expo-linking";
import { enqueueEvent } from "./api";
import { requestShortcutStop } from "./shortcutStopRequests";

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
  const categoryId = firstString(query.categoryId);
  const categoryName = firstString(query.categoryName) ?? firstString(query.category);
  const description = firstString(query.description);
  const workspaceName = firstString(query.workspaceName) ?? firstString(query.workspace);

  if (action === "action/start") {
    return enqueueEvent({
      source: "shortcut",
      type: "shortcut_action",
      categoryId,
      description,
      rawPayload: {
        ...rawPayload,
        ...(categoryName ? { categoryName } : {}),
        ...(workspaceName ? { workspaceName } : {})
      }
    });
  }

  if (action === "action/stop") {
    // The link names no entry, and an untargeted Stop is never replayed: the Dashboard stops the block it
    // shows as running, through its targeted Stop outbox (`shortcutStopRequests.ts`).
    requestShortcutStop();
    return null;
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
