// The Review deck remembers open items it has shown so Undo, a failed save or a Location
// evidence decision can bring one back after a capped refresh paged it out. Each item is tagged
// with the account it was shown for and only read back for that account: an effect that runs late,
// after another account's data has arrived, can never put the old account's card in the new deck.

export type ReviewOwnerScoped = { workspace: { id: string }; user: { id: string } };

export function reviewDataOwnerKey(data: ReviewOwnerScoped) {
  return `${data.workspace.id}:${data.user.id}`;
}

export function createReviewKnownItems<T extends { id: string }>() {
  const items = new Map<string, { item: T; owner: string }>();
  return {
    clear: () => items.clear(),
    /** The remembered item, only when it was shown for the account loaded now. */
    get(itemId: string, loaded: ReviewOwnerScoped | null | undefined) {
      const entry = items.get(itemId);
      return entry && loaded && entry.owner === reviewDataOwnerKey(loaded) ? entry.item : undefined;
    },
    remember(item: T, owner: string) {
      items.set(item.id, { item, owner });
    }
  };
}
