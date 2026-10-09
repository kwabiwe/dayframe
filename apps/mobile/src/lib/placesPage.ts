import { placeSecondaryName, type PlaceRole } from "@dayframe/shared";

type PagePlace = {
  name: string;
  role?: PlaceRole | null;
  radiusMeters: number;
  loggingEnabled?: boolean;
  defaultCategoryId?: string | null;
  defaultCategoryName?: string | null;
  defaultActivityDescription?: string | null;
};

/**
 * Blocks parity step 7a: the plain line under a saved place on the Places page. The saved name
 * first when a role (Home, Work) is the title, then what a visit logs, then the radius.
 */
export function placeRowSubtitle(place: PagePlace, categories: readonly { id: string; name: string }[]) {
  const secondary = placeSecondaryName({ name: place.name, role: place.role ?? null });
  const radius = `${place.radiusMeters} m`;
  let visits: string;
  if (place.loggingEnabled === false) {
    visits = "Visits not suggested";
  } else {
    const activity = place.defaultCategoryName
      ?? categories.find((category) => category.id === place.defaultCategoryId)?.name
      ?? null;
    const description = place.defaultActivityDescription?.trim() || null;
    visits = activity
      ? `Logs ${description ? `“${description}” as ` : "as "}${activity}`
      : description ? `Logs “${description}”` : "No default activity";
  }
  return [secondary, `${visits} · ${radius}`].filter(Boolean).join("\n");
}

/** "4 visits on 3 days · last seen 6 Oct", the plain line under a suggested place. */
export function learnedPlaceSubtitle(input: { visitCount: number; distinctDayCount: number; lastSeenAt: string }) {
  const visits = input.visitCount === 1 ? "1 visit" : `${input.visitCount} visits`;
  const days = input.distinctDayCount === 1 ? "1 day" : `${input.distinctDayCount} days`;
  const lastSeen = new Date(input.lastSeenAt);
  const seen = Number.isNaN(lastSeen.getTime())
    ? "recently"
    : lastSeen.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${visits} on ${days} · last seen ${seen}`;
}
