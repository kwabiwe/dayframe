// When this phone sent the request behind a Review presentation response (client clock). The
// server takes its snapshot after the request arrives, so a cached item written before this moment
// and absent from the snapshot's complete open set is proven no longer open, with no comparison
// between the phone's clock and the server's.
const requestedAtByResponse = new WeakMap<object, string>();

export function rememberReviewPresentationRequestedAt<T extends object>(response: T, requestedAt: string): T {
  requestedAtByResponse.set(response, requestedAt);
  return response;
}

export function reviewPresentationRequestedAt(response: object): string | undefined {
  return requestedAtByResponse.get(response);
}
