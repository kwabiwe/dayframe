"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject
} from "react";
import { createPortal } from "react-dom";
import { Check, CheckCircle2, ChevronDown, Plus } from "lucide-react";
import {
  DAYFRAME_ACTIVITY_ICONS,
  DAYFRAME_ACTIVITY_ICON_FALLBACK_GLYPH,
  DAYFRAME_PALETTE_PICKER,
  DEFAULT_PALETTE_KEY,
  resolveActivityIcon,
  paletteCssColorFor,
  paletteKeyFor,
  suggestedActivityIconKey,
  type DayframePaletteKey
} from "@dayframe/shared";
import type { CategoryRow } from "@/lib/queries";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import {
  FLOATING_LIST_HINTS,
  FloatingList,
  FloatingListActivityOption,
  FloatingListSearch,
  restoreFocusIfDropped
} from "@/components/FloatingList";
import { blockStyle } from "@/lib/block-style";
import { activitiesForMention } from "@/lib/command-parse";

export type CreateCategoryOutcome =
  | { ok: true; category: CategoryRow }
  | { ok: false; error: string };

export function CategoryPicker({
  anchorRef,
  ariaLabelledBy,
  categories,
  className = "",
  disabled = false,
  label,
  menuId,
  onBeforeOpen,
  onCreateCategory,
  onOpenChange,
  onSelect,
  open,
  portal: portalProp = false,
  scope,
  selectedId,
  triggerId,
  triggerRef: externalTriggerRef,
  variant
}: {
  /**
   * The "block" variant's Activities list lines up with this field (the command timer's
   * Description, where the typed `@` list opens), and becomes the phone sheet under it.
   */
  anchorRef?: RefObject<HTMLElement | null>;
  ariaLabelledBy?: string;
  categories: CategoryRow[];
  className?: string;
  disabled?: boolean;
  label?: string;
  menuId: string;
  onBeforeOpen?: () => void;
  /** `icon` is a key from the shared activity icons: the typed name's suggestion unless one was picked. */
  onCreateCategory?: (name: string, color?: DayframePaletteKey, icon?: string) => Promise<CreateCategoryOutcome>;
  onOpenChange: (open: boolean) => void;
  onSelect: (categoryId: string) => void;
  open: boolean;
  portal?: boolean;
  /**
   * What the choice belongs to (the command timer passes its block scope, `completionScope`).
   * A new scope closes the list, and a pick or Create made for an earlier one is not applied.
   */
  scope?: string;
  selectedId: string;
  triggerId?: string;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  /**
   * "block" is the Blocks command timer: a solid activity square opening the Activities list (the
   * same FloatingList as the typed `@` list, with a search field). "more" is the entry editor's
   * "All activities" chip after its activity chips: it opens the searchable menu (with Create) and
   * shows no selection of its own.
   */
  variant: "timer" | "quick" | "block" | "more";
}) {
  const menuVariant = variant === "quick" || variant === "more" ? "quick" : "timer";
  // The editor's "All activities" menu always floats over the page (a portal) at its own width, so
  // it is never as narrow as its chip, with or without Create.
  const portal = portalProp || variant === "more";
  const rootRef = useRef<HTMLDivElement | null>(null);
  const localTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const optionsRef = useRef<HTMLDivElement | null>(null);
  const createOptionRef = useRef<HTMLButtonElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const colorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const colorMenuRef = useRef<HTMLDivElement | null>(null);
  const cancelCreateRef = useRef<HTMLButtonElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreateBusy, setIsCreateBusy] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createColor, setCreateColor] = useState<DayframePaletteKey | null>(null);
  const [isColorMenuOpen, setIsColorMenuOpen] = useState(false);
  // null: the new activity's icon follows the typed name (else the neutral Other; Trello D item 11).
  const [createIcon, setCreateIcon] = useState<string | null>(null);
  const [isIconGridOpen, setIsIconGridOpen] = useState(false);
  const iconTriggerRef = useRef<HTMLButtonElement>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [portalPosition, setPortalPosition] = useState<CSSProperties | null>(null);
  const [colorMenuPosition, setColorMenuPosition] = useState<CSSProperties | null>(null);
  // The command timer's activity block opens the Activities list (owner, 14 Oct 2026: one
  // implementation with the typed `@` list): a search field, "No activity", every activity in the
  // bootstrap order (pinned first, then A–Z) and Create.
  const blockPanel = variant === "block";
  // The editors' "All activities" chip opens the same FloatingList (web UI audit WUI-024, owner
  // 17 Oct 2026): search field, "No activity", the #391 activity rows with a neutral check, Create.
  const listPanel = blockPanel || variant === "more";
  // The editor's "All activities" menu and the block's Activities list search; the others list every activity.
  const searchable = variant === "more" || blockPanel;
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const selectedCategory = categories.find((category) => category.id === selectedId) ?? null;
  const trimmedQuery = query.trim();
  const listedCategories = useMemo(() => {
    // The block's list filters with the `@` list's resolver: the exact name, then names starting
    // with the query, then names containing it.
    if (listPanel) return activitiesForMention(query.trim(), categories);
    const needle = query.trim().toLocaleLowerCase();
    return searchable && needle ? categories.filter((category) => category.name.toLocaleLowerCase().includes(needle)) : categories;
  }, [categories, listPanel, query, searchable]);
  // The block's list: "No activity" while nothing is searched; Create unless the name exists.
  const blockShowsNone = !listPanel || !trimmedQuery;
  const blockShowsCreate = Boolean(onCreateCategory) && (!listPanel || !categories.some(
    (category) => category.name.trim().toLocaleLowerCase() === trimmedQuery.toLocaleLowerCase()
  ));
  const optionValues = useMemo(
    () => [
      ...(blockShowsNone ? [""] : []),
      ...listedCategories.map((category) => category.id),
      ...(blockShowsCreate ? ["create"] : [])
    ],
    [blockShowsCreate, blockShowsNone, listedCategories]
  );
  const selectedIndex = Math.max(0, optionValues.indexOf(selectedId));
  const triggerRef = externalTriggerRef ?? localTriggerRef;
  const selectedColor = selectedCategory
    ? paletteCssColorFor(selectedCategory.color, selectedCategory.name)
    : null;
  const automaticCreateColor = createName.trim()
    ? paletteKeyFor(undefined, createName.trim())
    : DEFAULT_PALETTE_KEY;
  const effectiveCreateColor = createColor ?? automaticCreateColor;
  const effectiveCreateColorOption = DAYFRAME_PALETTE_PICKER.find(
    (color) => color.key === effectiveCreateColor
  ) ?? DAYFRAME_PALETTE_PICKER[0];
  const portalTarget = portal && typeof document !== "undefined"
    ? triggerRef.current?.closest("dialog") ?? document.body
    : null;
  const colorPortalTarget = typeof document !== "undefined"
    ? triggerRef.current?.closest("dialog") ?? document.body
    : null;

  // The block (`scope`) the list was opened for, the bar's current one (read after an await) and
  // the last one seen (Codex r3 on #402).
  const openedScopeRef = useRef(scope);
  const latestScopeRef = useRef(scope);
  const seenScopeRef = useRef(scope);
  useLayoutEffect(() => {
    latestScopeRef.current = scope;
  });
  // A new block closes the list, as it closes the typed lists; focus that was in it returns to
  // the button. A Create being saved keeps the list open so its outcome is seen; its new activity
  // is then not applied to the new block (above).
  useEffect(() => {
    if (seenScopeRef.current === scope) return;
    seenScopeRef.current = scope;
    // Focus anywhere in the list or the Create form's colour palette (its own body portal) goes
    // back to the block, never to the page (Codex r4 on #402).
    if (open && !isCreateBusy) closePicker(pickerContains(document.activeElement));
  });

  useEffect(() => {
    if (!open) return undefined;
    function closeOnOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target) &&
        !colorMenuRef.current?.contains(target) &&
        !isCreateBusy
      ) {
        // A press elsewhere closes the list; focus goes where the press puts it, and when that is
        // nowhere (non-focusable content, or a button WebKit does not focus) back to the block,
        // never the page (Codex r5 on #402).
        const hadFocus = pickerContains(document.activeElement);
        closePicker(false);
        if (hadFocus) window.setTimeout(() => restoreFocusIfDropped(triggerRef.current), 0);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented || pickerContains(event.target)) return;
      event.preventDefault();
      if (isCreateBusy) return;
      if (isColorMenuOpen) closeColorMenu(true);
      else if (isCreating) cancelCreate();
      else closePicker(true);
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  });

  useLayoutEffect(() => {
    if (!isColorMenuOpen) return undefined;

    function updateColorMenuPosition() {
      const trigger = colorTriggerRef.current;
      const panel = colorMenuRef.current;
      if (!trigger || !panel) return;

      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const margin = 12;
      const gap = 6;
      const triggerRect = trigger.getBoundingClientRect();
      const availableWidth = Math.max(0, viewportWidth - margin * 2);
      const width = Math.min(268, availableWidth);
      const left = Math.min(
        Math.max(viewportLeft + margin, triggerRect.left),
        Math.max(viewportLeft + margin, viewportLeft + viewportWidth - width - margin)
      );
      const belowTop = triggerRect.bottom + gap;
      const belowSpace = viewportTop + viewportHeight - margin - belowTop;
      const aboveSpace = triggerRect.top - gap - (viewportTop + margin);
      const contentHeight = Math.min(panel.scrollHeight || panel.getBoundingClientRect().height, 320);
      const placeBelow = contentHeight <= belowSpace || belowSpace >= aboveSpace;
      const availableHeight = Math.max(0, placeBelow ? belowSpace : aboveSpace);
      const maxHeight = Math.min(320, availableHeight);
      const renderedHeight = Math.min(contentHeight, maxHeight);
      const top = placeBelow
        ? belowTop
        : Math.max(viewportTop + margin, triggerRect.top - gap - renderedHeight);

      setColorMenuPosition({
        bottom: "auto",
        left,
        maxHeight,
        right: "auto",
        top,
        width
      });
    }

    updateColorMenuPosition();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateColorMenuPosition);
    if (colorTriggerRef.current) observer?.observe(colorTriggerRef.current);
    if (colorMenuRef.current) observer?.observe(colorMenuRef.current);
    window.addEventListener("resize", updateColorMenuPosition);
    window.addEventListener("scroll", updateColorMenuPosition, true);
    window.visualViewport?.addEventListener("resize", updateColorMenuPosition);
    window.visualViewport?.addEventListener("scroll", updateColorMenuPosition);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateColorMenuPosition);
      window.removeEventListener("scroll", updateColorMenuPosition, true);
      window.visualViewport?.removeEventListener("resize", updateColorMenuPosition);
      window.visualViewport?.removeEventListener("scroll", updateColorMenuPosition);
    };
  }, [isColorMenuOpen]);

  useLayoutEffect(() => {
    if (!open || !portal) return undefined;

    function updatePosition() {
      const trigger = triggerRef.current;
      const root = rootRef.current;
      const menu = menuRef.current;
      if (!trigger || !root || !menu) return;

      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const margin = 12;
      const gap = 6;
      // The block's Activities list lines up with the Description field, where `@` opens it.
      const anchor = blockPanel ? anchorRef?.current ?? root : null;
      const triggerRect = (anchor ?? trigger).getBoundingClientRect();
      const rootRect = (anchor ?? root).getBoundingClientRect();
      const availableWidth = Math.max(0, viewportWidth - margin * 2);
      // The "All activities" chip is narrow; its menu takes a comfortable width of its own.
      const width = Math.min(
        blockPanel ? rootRect.width : searchable ? Math.max(300, rootRect.width) : rootRect.width || triggerRect.width,
        availableWidth
      );
      // The typed lists' 19rem plus the search field (22.5rem), so as many rows show; they scroll inside.
      const heightCap = listPanel ? 360 : 220;
      const left = Math.min(
        Math.max(viewportLeft + margin, rootRect.left),
        Math.max(viewportLeft + margin, viewportLeft + viewportWidth - width - margin)
      );
      const belowTop = triggerRect.bottom + gap;
      const belowSpace = viewportTop + viewportHeight - margin - belowTop;
      const aboveSpace = triggerRect.top - gap - (viewportTop + margin);
      const contentHeight = Math.min(menu.scrollHeight || menu.getBoundingClientRect().height, heightCap);
      const placeBelow = contentHeight <= belowSpace || belowSpace >= aboveSpace;
      const availableHeight = Math.max(0, placeBelow ? belowSpace : aboveSpace);
      const maxHeight = Math.min(heightCap, availableHeight);
      const renderedHeight = Math.min(contentHeight, maxHeight);
      const top = placeBelow
        ? belowTop
        : Math.max(viewportTop + margin, triggerRect.top - gap - renderedHeight);

      setPortalPosition({
        bottom: "auto",
        left,
        maxHeight,
        right: "auto",
        top,
        width
      });
    }

    updatePosition();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    if (rootRef.current) observer?.observe(rootRef.current);
    if (menuRef.current) observer?.observe(menuRef.current);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [anchorRef, blockPanel, listPanel, open, portal, searchable, triggerRef]);

  function assignTrigger(node: HTMLButtonElement | null) {
    localTriggerRef.current = node;
    if (externalTriggerRef) externalTriggerRef.current = node;
  }

  function closePicker(restoreFocus: boolean) {
    if (!isCreateBusy) {
      setIsCreating(false);
      setCreateName("");
      setCreateColor(null);
      setIsColorMenuOpen(false);
      setCreateError(null);
    }
    // The block's Activities list fades out where it stood (#391: opacity only, at its final
    // position and width), so its measured geometry stays through the exit; opening measures anew.
    if (!listPanel) setPortalPosition(null);
    setColorMenuPosition(null);
    onOpenChange(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function openPicker(focus: "selected" | "last" | null = null) {
    // Opening resets the Create form, so it never runs while a Create is saving (Codex r2 on
    // #402): the form, its name and its late outcome stay where they are.
    if (disabled || isCreateBusy) return;
    openedScopeRef.current = scope;
    onBeforeOpen?.();
    setIsCreating(false);
    setCreateColor(null);
    setIsColorMenuOpen(false);
    setCreateError(null);
    setPortalPosition(null);
    setColorMenuPosition(null);
    // Reopening clears the search, so the selected activity is found in the full list.
    const fullIndex = Math.max(0, ["", ...categories.map((category) => category.id)].indexOf(selectedId));
    const fullCount = 1 + categories.length + (onCreateCategory ? 1 : 0);
    setActiveIndex(focus === "last" ? (listPanel ? fullCount : optionValues.length) - 1 : searchable ? fullIndex : selectedIndex);
    setQuery("");
    onOpenChange(true);
    // The block's list keeps focus in its search field (the combobox); ↑/↓ move the highlight.
    if (searchable && (!focus || listPanel)) window.requestAnimationFrame(() => searchRef.current?.focus());
    if (focus && !listPanel) {
      window.requestAnimationFrame(() => {
        const options = categoryOptions();
        options[focus === "last" ? options.length - 1 : searchable ? fullIndex : selectedIndex]?.focus();
      });
    }
  }

  function categoryOptions() {
    return [...(optionsRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
  }

  function pickerContains(target: EventTarget | null) {
    return target instanceof Node && (
      Boolean(rootRef.current?.contains(target)) ||
      Boolean(menuRef.current?.contains(target)) ||
      Boolean(colorMenuRef.current?.contains(target))
    );
  }

  function colorMenuContains(target: EventTarget | null) {
    return target instanceof Node && (
      Boolean(colorTriggerRef.current?.contains(target)) ||
      Boolean(colorMenuRef.current?.contains(target))
    );
  }

  function closeOnFocusLeave(event: ReactFocusEvent<HTMLElement>) {
    // Focus moving to no element is not a dismissal: WebKit blurs this way when its button is
    // pressed (the press then toggles the list closed, Codex r5 on #402), as does the window
    // losing focus. A press elsewhere is handled by `closeOnOutside`.
    if (!event.relatedTarget) return;
    if (open && !isCreateBusy && !pickerContains(event.relatedTarget)) closePicker(false);
  }

  function handlePickerKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Tab" && portal && open) {
      const activeElement = document.activeElement as HTMLElement | null;
      const menuFocusable = [...(menuRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      ) ?? [])].filter((element) => !element.closest("[hidden], [inert]"));
      if (activeElement === triggerRef.current && !event.shiftKey && menuFocusable[0]) {
        event.preventDefault();
        menuFocusable[0].focus();
      } else if (menuRef.current?.contains(activeElement) && event.shiftKey && activeElement === menuFocusable[0]) {
        event.preventDefault();
        triggerRef.current?.focus();
      } else if (
        menuRef.current?.contains(activeElement) &&
        !event.shiftKey &&
        activeElement === menuFocusable[menuFocusable.length - 1]
      ) {
        event.preventDefault();
        const boundary = triggerRef.current?.closest<HTMLElement>(
          'dialog, form, [data-testid="time-entry-quick-editor"]'
        ) ?? document.body;
        const boundaryFocusable = [...boundary.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )].filter((element) => !menuRef.current?.contains(element) && !element.closest("[hidden], [inert]"));
        const triggerIndex = boundaryFocusable.indexOf(triggerRef.current as HTMLElement);
        boundaryFocusable[triggerIndex + 1]?.focus();
        // A Create being saved keeps the list (and its outcome) open, as every other dismissal does.
        if (!isCreateBusy) closePicker(false);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      if (isCreateBusy) return;
      if (isColorMenuOpen) closeColorMenu(true);
      else if (isCreating) cancelCreate();
      else closePicker(true);
    }
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    // An open Create form (saving or not) is never reset from the button: ↑/↓ go back to it.
    if (open && isCreating) {
      if (!isCreateBusy) nameInputRef.current?.focus();
      return;
    }
    openPicker(event.key === "ArrowUp" ? "last" : "selected");
  }

  function handleOptionsKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const options = categoryOptions();
    if (!options.length) return;
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    const forward = event.key === "ArrowDown";
    const backward = event.key === "ArrowUp";
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (forward) nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % options.length;
    if (backward) nextIndex = currentIndex < 0 ? options.length - 1 : (currentIndex - 1 + options.length) % options.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = options.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setActiveIndex(nextIndex);
    options[nextIndex]?.focus();
  }

  /** The block's search field: ↑/↓ move the highlight (wrapping), Enter picks or starts Create. */
  function handleBlockSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    // Keys that drive an input method's candidates stay with the input method.
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      event.stopPropagation();
      return;
    }
    const count = optionValues.length;
    const current = Math.min(activeIndex, Math.max(0, count - 1));
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (count) setActiveIndex((current + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
    } else if (event.key === "Enter") {
      // Never the surrounding form's submit (the command timer's Start).
      event.preventDefault();
      const value = optionValues[current];
      if (value === undefined) return;
      if (value === "create") beginCreate();
      else chooseCategory(value);
    }
  }

  function chooseCategory(categoryId: string) {
    if (disabled || isCreateBusy) return;
    // A pick only changes the block the list was opened for.
    if (openedScopeRef.current === scope) onSelect(categoryId);
    closePicker(true);
  }

  function beginCreate() {
    if (!onCreateCategory || isCreateBusy) return;
    setIsCreating(true);
    // Create starts from what was searched for.
    setCreateName(searchable ? query.trim() : "");
    setCreateColor(null);
    setCreateIcon(null);
    setIsIconGridOpen(false);
    setIsColorMenuOpen(false);
    setCreateError(null);
    window.requestAnimationFrame(() => nameInputRef.current?.focus());
  }

  function cancelCreate() {
    if (isCreateBusy) return;
    setIsCreating(false);
    setCreateName("");
    setCreateColor(null);
    setCreateIcon(null);
    setIsIconGridOpen(false);
    setIsColorMenuOpen(false);
    setCreateError(null);
    window.requestAnimationFrame(() => (listPanel ? searchRef : createOptionRef).current?.focus());
  }

  async function submitCreate() {
    if (!onCreateCategory || isCreateBusy) return;
    const name = createName.trim();
    if (!name) {
      setCreateError("Enter an activity name.");
      nameInputRef.current?.focus();
      return;
    }
    if (categories.some((category) => category.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setCreateError(`An activity named “${name}” already exists.`);
      nameInputRef.current?.focus();
      return;
    }

    setIsCreateBusy(true);
    setCreateError(null);
    let outcome: CreateCategoryOutcome;
    try {
      outcome = await onCreateCategory(name, createColor ?? undefined, createIcon ?? suggestedActivityIconKey(name));
    } catch {
      outcome = { ok: false, error: "Unable to create this activity. Check your connection and try again." };
    }
    if (!outcome.ok) {
      setIsCreateBusy(false);
      setCreateError(outcome.error);
      window.requestAnimationFrame(() => nameInputRef.current?.focus());
      return;
    }

    setIsCreateBusy(false);
    setIsCreating(false);
    setCreateName("");
    setCreateColor(null);
    setCreateIcon(null);
    setIsIconGridOpen(false);
    setIsColorMenuOpen(false);
    // The new activity is chosen only if the block the list was opened for is still the bar's.
    if (openedScopeRef.current === latestScopeRef.current) onSelect(outcome.category.id);
    closePicker(true);
  }

  function openColorMenu() {
    if (isCreateBusy) return;
    setColorMenuPosition(null);
    setIsColorMenuOpen(true);
    window.requestAnimationFrame(() => {
      colorMenuRef.current
        ?.querySelector<HTMLButtonElement>(`[data-color="${effectiveCreateColor}"]`)
        ?.focus();
    });
  }

  function closeColorMenu(restoreFocus: boolean) {
    setIsColorMenuOpen(false);
    setColorMenuPosition(null);
    if (restoreFocus) window.requestAnimationFrame(() => colorTriggerRef.current?.focus());
  }

  function selectCreateColor(color: DayframePaletteKey) {
    setCreateColor(color);
    closeColorMenu(true);
  }

  function handleColorMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const options = [...(colorMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % options.length;
    if (event.key === "ArrowLeft") nextIndex = currentIndex < 0 ? options.length - 1 : (currentIndex - 1 + options.length) % options.length;
    if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : Math.min(options.length - 1, currentIndex + 5);
    if (event.key === "ArrowUp") nextIndex = currentIndex < 0 ? options.length - 1 : Math.max(0, currentIndex - 5);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = options.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      event.stopPropagation();
      options[nextIndex]?.focus();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      closeColorMenu(false);
      (event.shiftKey ? nameInputRef.current : cancelCreateRef.current)?.focus();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      closeColorMenu(true);
    }
  }

  function createInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      void submitCreate();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      cancelCreate();
    }
  }

  const wrapperClass = menuVariant === "timer"
    ? `swiss-category-field ${className}`.trim()
    : `calendar-compact-category-field ${className}`.trim();
  const menuClass = menuVariant === "timer"
    ? `ui-floating-surface swiss-category-menu${open ? " is-open" : ""}`
    : "calendar-compact-category-menu";

  const shownCreateIcon = createIcon ?? suggestedActivityIconKey(createName.trim());
  const focusCreateIcon = (key: string) =>
    document.getElementById(`${menuId}-create-icons`)?.querySelector<HTMLElement>(`[data-icon="${key}"]`)?.focus();
  const shownCreateIconOption = DAYFRAME_ACTIVITY_ICONS.find((option) => option.key === shownCreateIcon)!;
  const createForm = (
          <div
            aria-label="Create new activity"
            className="category-picker-create-form"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              event.nativeEvent.stopImmediatePropagation();
              // Escape closes the icon choices first and keeps the draft (Codex r1 on #593).
              if (isIconGridOpen) {
                setIsIconGridOpen(false);
                iconTriggerRef.current?.focus();
                return;
              }
              cancelCreate();
            }}
            role="dialog"
          >
            <strong>Create new activity</strong>
            <div className="category-picker-create-name-field">
              <label htmlFor={`${menuId}-create-name`}>Name</label>
              <div className="category-picker-create-name-control">
                <input
                  aria-describedby={createError ? `${menuId}-create-error` : undefined}
                  aria-invalid={createError ? "true" : undefined}
                  autoComplete="off"
                  disabled={isCreateBusy}
                  id={`${menuId}-create-name`}
                  onChange={(event) => {
                    setCreateName(event.target.value);
                    setCreateError(null);
                  }}
                  onKeyDown={createInputKeyDown}
                  placeholder="Activity name"
                  ref={nameInputRef}
                  value={createName}
                />
                <button
                  aria-expanded={isColorMenuOpen}
                  aria-haspopup="listbox"
                  aria-label={`Choose activity colour, currently ${effectiveCreateColorOption.label}`}
                  className="category-picker-color-trigger"
                  disabled={isCreateBusy}
                  onClick={() => {
                    if (isColorMenuOpen) closeColorMenu(true);
                    else openColorMenu();
                  }}
                  ref={colorTriggerRef}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="category-picker-color-swatch"
                    style={{ background: paletteCssColorFor(effectiveCreateColorOption.key) }}
                  />
                </button>
                <button
                  aria-controls={`${menuId}-create-icons`}
                  aria-expanded={isIconGridOpen}
                  aria-label={`Choose activity icon, currently ${shownCreateIconOption.label}`}
                  className="category-picker-icon-trigger"
                  data-testid="category-picker-create-icon"
                  disabled={isCreateBusy}
                  onClick={() => {
                    const opening = !isIconGridOpen;
                    setIsIconGridOpen(opening);
                    // Focus moves to the checked icon, which also scrolls it into view (Other is last).
                    if (opening) window.requestAnimationFrame(() => focusCreateIcon(shownCreateIcon));
                  }}
                  ref={iconTriggerRef}
                  type="button"
                >
                  <DayframeIcon glyph={shownCreateIconOption.glyph} size={18} />
                </button>
              </div>
            </div>
            {isIconGridOpen ? (
              <div aria-label="Activity icon" className="df-ce-icons category-picker-icon-grid" id={`${menuId}-create-icons`} role="radiogroup">
                {DAYFRAME_ACTIVITY_ICONS.map((option) => (
                  <button
                    aria-checked={option.key === shownCreateIcon}
                    aria-label={option.label}
                    data-icon={option.key}
                    disabled={isCreateBusy}
                    key={option.key}
                    onClick={() => {
                      setCreateIcon(option.key);
                      setIsIconGridOpen(false);
                      window.requestAnimationFrame(() => iconTriggerRef.current?.focus());
                    }}
                    onKeyDown={(event) => {
                      // One Tab stop; arrows move the choice, as in the Library editor's icon group.
                      const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
                      if (!step || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const index = DAYFRAME_ACTIVITY_ICONS.findIndex((candidate) => candidate.key === shownCreateIcon);
                      const next = DAYFRAME_ACTIVITY_ICONS[(index + step + DAYFRAME_ACTIVITY_ICONS.length) % DAYFRAME_ACTIVITY_ICONS.length].key;
                      setCreateIcon(next);
                      focusCreateIcon(next);
                    }}
                    role="radio"
                    tabIndex={option.key === shownCreateIcon ? 0 : -1}
                    title={option.label}
                    type="button"
                  >
                    <DayframeIcon glyph={option.glyph} size={18} />
                  </button>
                ))}
              </div>
            ) : null}
            <p
              aria-live="assertive"
              className={`category-picker-create-error${createError ? " is-visible" : ""}`}
              id={`${menuId}-create-error`}
              role={createError ? "alert" : undefined}
            >
              {createError ?? " "}
            </p>
            <div className="category-picker-create-actions">
              <button disabled={isCreateBusy} onClick={cancelCreate} ref={cancelCreateRef} type="button">Cancel</button>
              <button
                aria-busy={isCreateBusy || undefined}
                className="is-primary"
                disabled={isCreateBusy}
                onClick={() => void submitCreate()}
                type="button"
              >
                {isCreateBusy ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
  );

  function mountMenu(menu: ReactNode) {
    return portal && portalTarget ? createPortal(menu, portalTarget) : menu;
  }

  return (
    <div
      className={wrapperClass}
      onBlur={closeOnFocusLeave}
      onKeyDown={handlePickerKeyDown}
      ref={rootRef}
    >
      {label ? <span className="calendar-compact-field-label">{label}</span> : null}
      {variant === "block" ? (
        <button
          aria-controls={menuId}
          aria-expanded={open}
          aria-haspopup={isCreating ? "dialog" : "listbox"}
          aria-label={`Activity: ${selectedCategory?.name ?? "No activity"}`}
          className={`df-cmd-activity${selectedCategory ? " df-block" : ""}`}
          disabled={disabled}
          id={triggerId}
          onClick={() => {
            if (open) {
              // A second press closes the list with focus on the block (WebKit leaves a clicked button unfocused).
              if (!isCreateBusy) closePicker(true);
              return;
            }
            openPicker();
          }}
          onKeyDown={handleTriggerKeyDown}
          ref={assignTrigger}
          style={selectedCategory ? blockStyle(selectedCategory.color, selectedCategory.name) : undefined}
          title={`Activity: ${selectedCategory?.name ?? "No activity"}`}
          type="button"
        >
          {/* No activity is the neutral activity dot, as on Today's rows; never the tag glyph,
              which means "add tags" (the description's own control). */}
          <DayframeIcon
            glyph={selectedCategory ? resolveActivityIcon(selectedCategory).glyph : DAYFRAME_ACTIVITY_ICON_FALLBACK_GLYPH}
            size={20}
          />
        </button>
      ) : variant === "more" ? (
        <button
          aria-controls={menuId}
          aria-expanded={open}
          aria-haspopup={isCreating ? "dialog" : "listbox"}
          aria-label={`All activities, ${categories.length}`}
          className="df-rchip df-rchip--more"
          disabled={disabled}
          id={triggerId}
          onClick={() => {
            if (open) {
              if (!isCreateBusy) closePicker(false);
              return;
            }
            openPicker();
          }}
          onKeyDown={handleTriggerKeyDown}
          ref={assignTrigger}
          type="button"
        >
          All activities
          <span aria-hidden="true" className="df-tnum">{categories.length}</span>
        </button>
      ) : (
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup={isCreating ? "dialog" : "listbox"}
        aria-labelledby={ariaLabelledBy}
        className={menuVariant === "timer" ? "swiss-category-trigger" : undefined}
        disabled={disabled}
        id={triggerId}
        onClick={() => {
          if (open) {
            if (!isCreateBusy) closePicker(false);
            return;
          }
          openPicker();
        }}
        onKeyDown={handleTriggerKeyDown}
        ref={assignTrigger}
        type="button"
      >
        <span className={menuVariant === "timer" ? "swiss-category-trigger-value" : "category-picker-trigger-value"}>
          <span
            aria-hidden="true"
            className={menuVariant === "timer"
              ? `swiss-focus-dot${selectedCategory ? "" : " is-muted"}`
              : "calendar-compact-category-dot"}
            style={{ background: selectedColor ?? (menuVariant === "timer" ? "transparent" : "var(--muted)") }}
          />
          <span>{selectedCategory?.name ?? "No activity"}</span>
        </span>
        <ChevronDown aria-hidden="true" size={menuVariant === "timer" ? 16 : 15} />
      </button>
      )}
      {listPanel ? mountMenu(<FloatingList
        activeId={optionValues.length ? `${menuId}-option-${Math.min(activeIndex, optionValues.length - 1)}` : undefined}
        anchorRef={blockPanel ? anchorRef : rootRef}
        body={isCreating ? createForm : undefined}
        className={blockPanel
          ? `df-cmd-activity-panel${portal ? " is-portalled" : ""}`
          // Inside the editor's outside-press and Tab boundary, as every editor surface is.
          : "df-more-activity-panel is-portalled time-entry-quick-editor-nested-surface"}
        heading="Activities"
        hints={FLOATING_LIST_HINTS.activities}
        id={menuId}
        isOpen={open}
        onBlur={closeOnFocusLeave}
        // A Create being saved holds the list open (as Escape, a press outside and the block do), so
        // its outcome — the new activity or the error beside the kept name — is always seen.
        closeDisabled={isCreateBusy}
        onClose={() => {
          if (!isCreateBusy) closePicker(true);
        }}
        onKeyDown={handlePickerKeyDown}
        panelRef={menuRef}
        returnFocusRef={triggerRef}
        search={(
          <FloatingListSearch
            activeDescendant={optionValues.length ? `${menuId}-option-${Math.min(activeIndex, optionValues.length - 1)}` : undefined}
            expanded={open}
            inputRef={searchRef}
            label="Search activities"
            listId={menuId}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleBlockSearchKeyDown}
            value={query}
          />
        )}
        // Hidden only until it is first measured; after that the surface's own open state (and
        // its fade, with visibility held until the fade ends) rules, at the kept geometry.
        style={portal ? portalPosition ?? { visibility: "hidden" } : undefined}
      >
        {/* Nothing matches: say so above Create. */}
        {listedCategories.length === 0 && trimmedQuery ? (
          <span className="df-flist-empty">No activity called “{trimmedQuery}”</span>
        ) : null}
        {optionValues.map((value, index) => {
          const highlighted = Math.min(activeIndex, optionValues.length - 1) === index;
          const optionId = `${menuId}-option-${index}`;
          if (value === "create") {
            // Create reads like the Tags list's: primary text with a neutral "+", named by its text.
            return (
              <button
                aria-selected={false}
                className={`df-flist-row df-flist-row--create is-create${highlighted ? " is-highlighted" : ""}`}
                id={optionId}
                key="create"
                onClick={beginCreate}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                ref={createOptionRef}
                role="option"
                tabIndex={-1}
                type="button"
              >
                <span aria-hidden="true" className="df-flist-lead"><Plus size={14} strokeWidth={2.2} /></span>
                <span className="df-flist-label">{trimmedQuery ? `Create “${trimmedQuery}”` : "Create new activity"}</span>
              </button>
            );
          }
          const category = value ? categories.find((candidate) => candidate.id === value) ?? null : null;
          return (
            <FloatingListActivityOption
              activity={category}
              current={value === selectedId}
              highlighted={highlighted}
              id={optionId}
              key={value || "none"}
              onHighlight={() => setActiveIndex(index)}
              onPick={() => chooseCategory(value)}
              selected={value === selectedId}
            />
          );
        })}
      </FloatingList>) : null}
      {!listPanel ? mountMenu(<div
        aria-hidden={!open}
        className={`${menuClass} category-picker-menu${portal ? " is-portalled time-entry-quick-editor-nested-surface" : ""}`}
        hidden={variant === "quick" && !open}
        id={menuId}
        inert={!open}
        onBlur={closeOnFocusLeave}
        onKeyDown={handlePickerKeyDown}
        ref={menuRef}
        style={portal ? {
          ...portalPosition,
          visibility: open && portalPosition ? "visible" : "hidden"
        } : undefined}
      >
        {isCreating ? createForm : (
          <>
          {searchable ? (
            <input
              aria-controls={`${menuId}-options`}
              aria-label="Search activities"
              autoComplete="off"
              className="ui-control category-picker-search"
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                // Keys that drive an input method's candidates stay with the input method.
                // (Escape that cancels a candidate must not reach the menu's close handler either.)
                if (event.nativeEvent.isComposing || event.keyCode === 229) {
                  event.stopPropagation();
                  return;
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  categoryOptions()[listedCategories.length ? 1 : 0]?.focus();
                } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (listedCategories.length && query.trim()) chooseCategory(listedCategories[0].id);
                }
              }}
              placeholder="Search activities"
              ref={searchRef}
              type="search"
              value={query}
            />
          ) : null}
          <div
            aria-label="Activities"
            className="category-picker-options"
            id={`${menuId}-options`}
            onKeyDown={handleOptionsKeyDown}
            ref={optionsRef}
            role="listbox"
          >
            <CategoryOption
              active={activeIndex === 0}
              category={null}
              onFocus={() => setActiveIndex(0)}
              onSelect={() => chooseCategory("")}
              selected={!selectedId}
              variant={menuVariant}
            />
            {listedCategories.map((category, index) => (
              <CategoryOption
                active={activeIndex === index + 1}
                category={category}
                key={category.id}
                onFocus={() => setActiveIndex(index + 1)}
                onSelect={() => chooseCategory(category.id)}
                selected={category.id === selectedId}
                variant={menuVariant}
              />
            ))}
            {onCreateCategory ? (
              <button
                aria-selected="false"
                className={menuVariant === "timer"
                  ? "swiss-category-option category-picker-create-option"
                  : `category-picker-create-option${activeIndex === optionValues.length - 1 ? " is-active" : ""}`}
                onClick={beginCreate}
                onFocus={() => setActiveIndex(optionValues.length - 1)}
                ref={createOptionRef}
                role="option"
                type="button"
              >
                <Plus aria-hidden="true" size={15} />
                <span>{searchable && query.trim() ? `Create “${query.trim()}”` : "Create new activity"}</span>
              </button>
            ) : null}
          </div>
          </>
        )}
      </div>) : null}
      {isColorMenuOpen && colorPortalTarget ? createPortal(
        <div
          aria-label="Activity colour"
          className="ui-floating-surface is-open category-picker-color-menu time-entry-quick-editor-nested-surface"
          onBlur={(event) => {
            if (!colorMenuContains(event.relatedTarget)) closeColorMenu(false);
          }}
          onKeyDown={handleColorMenuKeyDown}
          ref={colorMenuRef}
          role="listbox"
          style={{
            ...colorMenuPosition,
            visibility: colorMenuPosition ? "visible" : "hidden"
          }}
        >
          {DAYFRAME_PALETTE_PICKER.map((color, index) => (
            <button
              aria-label={`Use ${color.label} colour, shade ${index + 1}`}
              aria-selected={color.key === effectiveCreateColor}
              data-color={color.key}
              key={color.key}
              onClick={() => selectCreateColor(color.key)}
              role="option"
              tabIndex={color.key === effectiveCreateColor ? 0 : -1}
              title={color.label}
              type="button"
            >
              <span
                aria-hidden="true"
                className="category-picker-color-swatch"
                style={{ background: paletteCssColorFor(color.key) }}
              />
              {color.key === effectiveCreateColor ? <Check aria-hidden="true" size={14} /> : null}
            </button>
          ))}
        </div>,
        colorPortalTarget
      ) : null}
    </div>
  );
}

function CategoryOption({
  active,
  category,
  onFocus,
  onSelect,
  selected,
  variant
}: {
  active: boolean;
  category: CategoryRow | null;
  onFocus: () => void;
  onSelect: () => void;
  selected: boolean;
  variant: "timer" | "quick";
}) {
  const color = category ? paletteCssColorFor(category.color, category.name) : null;
  return (
    <button
      aria-selected={selected}
      className={variant === "timer"
        ? ["swiss-category-option", color ? "" : "is-muted", selected ? "is-selected" : ""].filter(Boolean).join(" ")
        : active ? "is-active" : ""}
      onClick={onSelect}
      onFocus={onFocus}
      role="option"
      type="button"
    >
      <span
        aria-hidden="true"
        className={variant === "timer"
          ? `swiss-focus-dot${color ? "" : " is-muted"}`
          : "calendar-compact-category-dot"}
        style={{ background: color ?? (variant === "timer" ? undefined : "var(--muted)") }}
      />
      <span>{category?.name ?? "No activity"}</span>
      {selected
        ? variant === "timer"
          ? <CheckCircle2 aria-hidden="true" size={14} />
          : <Check aria-hidden="true" size={15} />
        : null}
    </button>
  );
}
