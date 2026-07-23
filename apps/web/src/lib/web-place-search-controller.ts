import type { WebPlaceSuggestion } from "./place-search";

export const WEB_PLACE_SEARCH_MINIMUM_QUERY_LENGTH = 2;
export const WEB_PLACE_SEARCH_DEBOUNCE_MS = 250;

export type WebPlaceSearchState = {
  query: string;
  status: "idle" | "typing" | "loading" | "results" | "no-results" | "error" | "selected";
  suggestions: WebPlaceSuggestion[];
  activeIndex: number;
  message: string | null;
};

export type WebPlaceSearchRequest = (
  query: string,
  signal: AbortSignal
) => Promise<WebPlaceSuggestion[]>;

const initialState = (): WebPlaceSearchState => ({
  query: "",
  status: "idle",
  suggestions: [],
  activeIndex: -1,
  message: null
});

export class WebPlaceSearchController {
  private state = initialState();
  private readonly search: WebPlaceSearchRequest;
  private readonly onStateChange: (state: WebPlaceSearchState) => void;
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private request: AbortController | null = null;
  private sequence = 0;
  private disposed = false;

  constructor(
    search: WebPlaceSearchRequest,
    onStateChange: (state: WebPlaceSearchState) => void,
    debounceMs = WEB_PLACE_SEARCH_DEBOUNCE_MS
  ) {
    this.search = search;
    this.onStateChange = onStateChange;
    this.debounceMs = debounceMs;
  }

  getState() {
    return this.state;
  }

  updateQuery(query: string) {
    if (this.disposed) return;
    this.cancelPending();
    const normalized = query.trim();
    const requestId = ++this.sequence;
    if (normalized.length < WEB_PLACE_SEARCH_MINIMUM_QUERY_LENGTH) {
      this.setState({
        query,
        status: normalized.length ? "typing" : "idle",
        suggestions: [],
        activeIndex: -1,
        message: null
      });
      return;
    }

    this.setState({
      query,
      status: "typing",
      suggestions: [],
      activeIndex: -1,
      message: null
    });
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.disposed || requestId !== this.sequence) return;
      const controller = new AbortController();
      this.request = controller;
      this.setState({ ...this.state, status: "loading" });
      void this.search(normalized, controller.signal)
        .then((suggestions) => {
          if (this.disposed || controller.signal.aborted || requestId !== this.sequence) return;
          const results = suggestions.slice(0, 6);
          this.setState({
            ...this.state,
            status: results.length ? "results" : "no-results",
            suggestions: results,
            activeIndex: results.length ? 0 : -1,
            message: results.length
              ? null
              : "No matches found. Try a fuller address or place name."
          });
        })
        .catch((error: unknown) => {
          if (this.disposed || controller.signal.aborted || requestId !== this.sequence) return;
          this.setState({
            ...this.state,
            status: "error",
            suggestions: [],
            activeIndex: -1,
            message: friendlyWebPlaceSearchError(error)
          });
        })
        .finally(() => {
          if (this.request === controller) this.request = null;
        });
    }, this.debounceMs);
  }

  moveActive(direction: 1 | -1) {
    if (!this.state.suggestions.length) return;
    const next = this.state.activeIndex + direction;
    const activeIndex = next < 0
      ? this.state.suggestions.length - 1
      : next >= this.state.suggestions.length
        ? 0
        : next;
    this.setState({ ...this.state, activeIndex });
  }

  moveToBoundary(boundary: "start" | "end") {
    if (!this.state.suggestions.length) return;
    this.setState({
      ...this.state,
      activeIndex: boundary === "start" ? 0 : this.state.suggestions.length - 1
    });
  }

  activeSuggestion() {
    return this.state.suggestions[this.state.activeIndex] ?? null;
  }

  dismiss() {
    this.cancelPending();
    this.sequence += 1;
    this.setState({
      ...this.state,
      status: this.state.query ? "typing" : "idle",
      suggestions: [],
      activeIndex: -1,
      message: null
    });
  }

  commitSelection(title: string) {
    this.cancelPending();
    this.sequence += 1;
    this.setState({
      query: title,
      status: "selected",
      suggestions: [],
      activeIndex: -1,
      message: null
    });
  }

  clear() {
    this.cancelPending();
    this.sequence += 1;
    this.setState(initialState());
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPending();
  }

  private setState(state: WebPlaceSearchState) {
    this.state = state;
    this.onStateChange(state);
  }

  private cancelPending() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.request?.abort();
    this.request = null;
  }
}

export function friendlyWebPlaceSearchError(error: unknown) {
  if (
    error instanceof Error &&
    /^Place search (?:is unavailable|took too long)\./.test(error.message.trim())
  ) {
    return error.message.trim();
  }
  return "Place search is unavailable. Use Current location or Advanced coordinates.";
}
