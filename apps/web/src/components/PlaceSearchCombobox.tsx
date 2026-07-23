"use client";

import { Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { clientFetch } from "@/lib/client-auth-fetch";
import type { WebPlaceSuggestion } from "@/lib/place-search";
import {
  WebPlaceSearchController,
  type WebPlaceSearchState
} from "@/lib/web-place-search-controller";
import type { WebPlaceSearchBias } from "@/lib/web-place-editor";
import { IconButton } from "./ui/Primitives";

const emptyState: WebPlaceSearchState = {
  query: "",
  status: "idle",
  suggestions: [],
  activeIndex: -1,
  message: null
};

export function PlaceSearchCombobox({
  getBias,
  onClear,
  onSelect
}: {
  getBias: () => Promise<WebPlaceSearchBias>;
  onClear: () => void;
  onSelect: (suggestion: WebPlaceSuggestion) => void;
}) {
  const listboxId = useId();
  const statusId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const getBiasRef = useRef(getBias);
  const [state, setState] = useState<WebPlaceSearchState>(emptyState);
  const controllerRef = useRef<WebPlaceSearchController | null>(null);

  useEffect(() => {
    getBiasRef.current = getBias;
  }, [getBias]);

  useEffect(() => {
    const controller = new WebPlaceSearchController(async (query, signal) => {
      const bias = await getBiasRef.current();
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const params = new URLSearchParams({ q: query, language: "en" });
      if (bias) {
        params.set("biasLat", String(bias.latitude));
        params.set("biasLon", String(bias.longitude));
      }
      const response = await clientFetch(`/api/place-search?${params.toString()}`, {
        cache: "no-store",
        signal
      });
      const payload = await response.json() as {
        suggestions?: WebPlaceSuggestion[];
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message
          ?? "Place search is unavailable. Use Current location or Advanced coordinates."
        );
      }
      return payload.suggestions ?? [];
    }, setState);
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const popupOpen = state.suggestions.length > 0;
  const activeOptionId = popupOpen && state.activeIndex >= 0
    ? `${listboxId}-option-${state.activeIndex}`
    : undefined;
  const statusText = resultStatusText(state);

  function choose(suggestion: WebPlaceSuggestion) {
    controllerRef.current?.commitSelection(suggestion.title);
    onSelect(suggestion);
    inputRef.current?.focus();
  }

  return (
    <div className="place-search">
      <label className="place-search-label" htmlFor={`${listboxId}-input`}>Address or place</label>
      <div className="ui-compound-control place-search-control">
        <Search aria-hidden="true" size={18} />
        <input
          ref={inputRef}
          id={`${listboxId}-input`}
          aria-activedescendant={activeOptionId}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-describedby={statusId}
          aria-expanded={popupOpen}
          aria-haspopup="listbox"
          autoComplete="off"
          className="place-search-input"
          placeholder="Search address or place"
          role="combobox"
          spellCheck={false}
          type="text"
          value={state.query}
          onBlur={() => window.setTimeout(() => controllerRef.current?.dismiss(), 0)}
          onChange={(event) => controllerRef.current?.updateQuery(event.target.value)}
          onKeyDown={(event) => {
            const controller = controllerRef.current;
            if (!controller) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              controller.moveActive(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              controller.moveActive(-1);
            } else if (event.key === "Enter" && popupOpen) {
              event.preventDefault();
              const suggestion = controller.activeSuggestion();
              if (suggestion) choose(suggestion);
            } else if (event.key === "Escape" && popupOpen) {
              event.preventDefault();
              controller.dismiss();
            } else if (event.key === "Home" && popupOpen) {
              event.preventDefault();
              controller.moveToBoundary("start");
            } else if (event.key === "End" && popupOpen) {
              event.preventDefault();
              controller.moveToBoundary("end");
            }
          }}
        />
        {state.query ? (
          <IconButton
            className="place-search-clear"
            label="Clear place search"
            onClick={() => {
              controllerRef.current?.clear();
              onClear();
              inputRef.current?.focus();
            }}
          >
            <X aria-hidden="true" size={17} />
          </IconButton>
        ) : null}
      </div>

      {popupOpen ? (
        <ul
          aria-label="Place suggestions"
          className="place-search-listbox"
          id={listboxId}
          role="listbox"
        >
          {state.suggestions.map((suggestion, index) => (
            <li
              aria-selected={state.activeIndex === index}
              className="place-search-option"
              id={`${listboxId}-option-${index}`}
              key={suggestion.id}
              role="option"
              tabIndex={-1}
              onClick={() => choose(suggestion)}
              onKeyDown={(event) => {
                if (event.key === "Enter") choose(suggestion);
              }}
              onMouseDown={(event) => event.preventDefault()}
            >
              <span className="place-search-option-title">{suggestion.title}</span>
              {suggestion.subtitle || suggestion.formattedAddress ? (
                <span className="place-search-option-subtitle">
                  {suggestion.subtitle || suggestion.formattedAddress}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <p
        className={[
          "place-search-status",
          state.status === "error" ? "is-error" : ""
        ].join(" ")}
        id={statusId}
        role="status"
      >
        {statusText}
      </p>
      <p className="place-search-attribution">
        Powered by <a href="https://www.geoapify.com/" rel="noreferrer" target="_blank">Geoapify</a>
        {" · "}
        <a href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">
          © OpenStreetMap contributors
        </a>
      </p>
    </div>
  );
}

function resultStatusText(state: WebPlaceSearchState) {
  if (state.status === "typing" && state.query.trim().length === 1) {
    return "Type one more character to search.";
  }
  if (state.status === "loading") return "Searching…";
  if (state.status === "results") {
    return `${state.suggestions.length} result${state.suggestions.length === 1 ? "" : "s"} available. Use the arrow keys to review.`;
  }
  return state.message ?? "";
}
