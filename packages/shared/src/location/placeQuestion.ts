/**
 * The question a place's "?" asks (card B, owner feedback 25 Oct; v4 step 12): "Visited {best guess}?" with
 * Yes / Edit / Not now, like Google Maps Timeline, or "Where were you?" with Edit when there is no guess. The
 * best guess is the place's own name as the server titles it (a saved place, then a name you gave it); the
 * server's generic titles are no guess. Answers stay suggestions, never rules.
 */

/** Titles Dayframe gives a place it cannot name: none of them is a guess. */
const GENERIC_PLACE_TITLES = new Set(["unknown place", "near saved places", "unclear place", "suggestion", "this"]);

/** A place's best guess from its title, or null when the title only says Dayframe doesn't know. */
export function visitedGuess(title: string | null | undefined): string | null {
  const name = title?.trim();
  return name && !GENERIC_PLACE_TITLES.has(name.toLowerCase()) ? name : null;
}

/** "Visited Peak Gym?" with a guess (Yes confirms it), else "Where were you?" (only Edit names it). */
export function placeQuestion(title: string | null | undefined): { question: string; guess: string | null } {
  const guess = visitedGuess(title);
  return { question: guess ? `Visited ${guess}?` : "Where were you?", guess };
}
