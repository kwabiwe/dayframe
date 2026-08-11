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
import { paletteCssColorFor } from "@dayframe/shared";
import type { CategoryRow } from "@/lib/queries";

export type CreateCategoryOutcome =
  | { ok: true; category: CategoryRow }
  | { ok: false; error: string };

export function CategoryPicker({
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
  portal = false,
  selectedId,
  triggerId,
  triggerRef: externalTriggerRef,
  variant
}: {
  ariaLabelledBy?: string;
  categories: CategoryRow[];
  className?: string;
  disabled?: boolean;
  label?: string;
  menuId: string;
  onBeforeOpen?: () => void;
  onCreateCategory?: (name: string) => Promise<CreateCategoryOutcome>;
  onOpenChange: (open: boolean) => void;
  onSelect: (categoryId: string) => void;
  open: boolean;
  portal?: boolean;
  selectedId: string;
  triggerId?: string;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  variant: "timer" | "quick";
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const localTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const optionsRef = useRef<HTMLDivElement | null>(null);
  const createOptionRef = useRef<HTMLButtonElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreateBusy, setIsCreateBusy] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [portalPosition, setPortalPosition] = useState<CSSProperties | null>(null);
  const selectedCategory = categories.find((category) => category.id === selectedId) ?? null;
  const optionValues = useMemo(
    () => ["", ...categories.map((category) => category.id), ...(onCreateCategory ? ["create"] : [])],
    [categories, onCreateCategory]
  );
  const selectedIndex = Math.max(0, optionValues.indexOf(selectedId));
  const triggerRef = externalTriggerRef ?? localTriggerRef;
  const selectedColor = selectedCategory
    ? paletteCssColorFor(selectedCategory.color, selectedCategory.name)
    : null;
  const portalTarget = portal && typeof document !== "undefined"
    ? triggerRef.current?.closest("dialog") ?? document.body
    : null;

  useEffect(() => {
    if (!open) return undefined;
    function closeOnOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target) && !isCreateBusy) {
        closePicker(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (isCreateBusy) return;
      if (isCreating) cancelCreate();
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
      const triggerRect = trigger.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const availableWidth = Math.max(0, viewportWidth - margin * 2);
      const width = Math.min(rootRect.width || triggerRect.width, availableWidth);
      const left = Math.min(
        Math.max(viewportLeft + margin, rootRect.left),
        Math.max(viewportLeft + margin, viewportLeft + viewportWidth - width - margin)
      );
      const belowTop = triggerRect.bottom + gap;
      const belowSpace = viewportTop + viewportHeight - margin - belowTop;
      const aboveSpace = triggerRect.top - gap - (viewportTop + margin);
      const contentHeight = Math.min(menu.scrollHeight || menu.getBoundingClientRect().height, 220);
      const placeBelow = contentHeight <= belowSpace || belowSpace >= aboveSpace;
      const availableHeight = Math.max(0, placeBelow ? belowSpace : aboveSpace);
      const maxHeight = Math.min(220, availableHeight);
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
  }, [open, portal, triggerRef]);

  function assignTrigger(node: HTMLButtonElement | null) {
    localTriggerRef.current = node;
    if (externalTriggerRef) externalTriggerRef.current = node;
  }

  function closePicker(restoreFocus: boolean) {
    if (!isCreateBusy) {
      setIsCreating(false);
      setCreateName("");
      setCreateError(null);
    }
    setPortalPosition(null);
    onOpenChange(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function openPicker(focus: "selected" | "last" | null = null) {
    if (disabled) return;
    onBeforeOpen?.();
    setIsCreating(false);
    setCreateError(null);
    setPortalPosition(null);
    setActiveIndex(focus === "last" ? optionValues.length - 1 : selectedIndex);
    onOpenChange(true);
    if (focus) {
      window.requestAnimationFrame(() => {
        const options = categoryOptions();
        options[focus === "last" ? options.length - 1 : selectedIndex]?.focus();
      });
    }
  }

  function categoryOptions() {
    return [...(optionsRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
  }

  function pickerContains(target: EventTarget | null) {
    return target instanceof Node && (
      Boolean(rootRef.current?.contains(target)) ||
      Boolean(menuRef.current?.contains(target))
    );
  }

  function closeOnFocusLeave(event: ReactFocusEvent<HTMLElement>) {
    if (open && !isCreateBusy && !pickerContains(event.relatedTarget)) closePicker(false);
  }

  function handlePickerKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Tab" && portal && open) {
      const activeElement = document.activeElement as HTMLElement | null;
      const menuFocusable = [...(menuRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
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
        closePicker(false);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      if (isCreateBusy) return;
      if (isCreating) cancelCreate();
      else closePicker(true);
    }
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    openPicker(event.key === "ArrowUp" ? "last" : "selected");
  }

  function handleOptionsKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const options = categoryOptions();
    if (!options.length) return;
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % options.length;
    if (event.key === "ArrowUp") nextIndex = currentIndex < 0 ? options.length - 1 : (currentIndex - 1 + options.length) % options.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = options.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setActiveIndex(nextIndex);
    options[nextIndex]?.focus();
  }

  function chooseCategory(categoryId: string) {
    if (disabled || isCreateBusy) return;
    onSelect(categoryId);
    closePicker(true);
  }

  function beginCreate() {
    if (!onCreateCategory || isCreateBusy) return;
    setIsCreating(true);
    setCreateName("");
    setCreateError(null);
    window.requestAnimationFrame(() => nameInputRef.current?.focus());
  }

  function cancelCreate() {
    if (isCreateBusy) return;
    setIsCreating(false);
    setCreateName("");
    setCreateError(null);
    window.requestAnimationFrame(() => createOptionRef.current?.focus());
  }

  async function submitCreate() {
    if (!onCreateCategory || isCreateBusy) return;
    const name = createName.trim();
    if (!name) {
      setCreateError("Enter a category name.");
      nameInputRef.current?.focus();
      return;
    }
    if (categories.some((category) => category.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setCreateError(`A category named “${name}” already exists.`);
      nameInputRef.current?.focus();
      return;
    }

    setIsCreateBusy(true);
    setCreateError(null);
    let outcome: CreateCategoryOutcome;
    try {
      outcome = await onCreateCategory(name);
    } catch {
      outcome = { ok: false, error: "Unable to create this category. Check your connection and try again." };
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
    onSelect(outcome.category.id);
    closePicker(true);
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

  const wrapperClass = variant === "timer"
    ? `swiss-category-field ${className}`.trim()
    : `calendar-compact-category-field ${className}`.trim();
  const menuClass = variant === "timer"
    ? `ui-floating-surface swiss-category-menu${open ? " is-open" : ""}`
    : "calendar-compact-category-menu";

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
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup={isCreating ? "dialog" : "listbox"}
        aria-labelledby={ariaLabelledBy}
        className={variant === "timer" ? "swiss-category-trigger" : undefined}
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
        <span className={variant === "timer" ? "swiss-category-trigger-value" : undefined}>
          <span
            aria-hidden="true"
            className={variant === "timer"
              ? `swiss-focus-dot${selectedCategory ? "" : " is-muted"}`
              : "calendar-compact-category-dot"}
            style={{ background: selectedColor ?? (variant === "timer" ? "transparent" : "var(--muted)") }}
          />
          <span>{selectedCategory?.name ?? "Uncategorized"}</span>
        </span>
        <ChevronDown aria-hidden="true" size={variant === "timer" ? 16 : 15} />
      </button>
      {mountMenu(<div
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
        {isCreating ? (
          <div
            aria-label="Create new category"
            className="category-picker-create-form"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              event.nativeEvent.stopImmediatePropagation();
              cancelCreate();
            }}
            role="dialog"
          >
            <strong>Create new category</strong>
            <label>
              <span>Name</span>
              <input
                aria-describedby={createError ? `${menuId}-create-error` : undefined}
                aria-invalid={createError ? "true" : undefined}
                autoComplete="off"
                disabled={isCreateBusy}
                onChange={(event) => {
                  setCreateName(event.target.value);
                  setCreateError(null);
                }}
                onKeyDown={createInputKeyDown}
                placeholder="Category name"
                ref={nameInputRef}
                value={createName}
              />
            </label>
            <p
              aria-live="assertive"
              className={`category-picker-create-error${createError ? " is-visible" : ""}`}
              id={`${menuId}-create-error`}
              role={createError ? "alert" : undefined}
            >
              {createError ?? " "}
            </p>
            <div className="category-picker-create-actions">
              <button disabled={isCreateBusy} onClick={cancelCreate} type="button">Cancel</button>
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
        ) : (
          <div
            aria-label="Categories"
            className="category-picker-options"
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
              variant={variant}
            />
            {categories.map((category, index) => (
              <CategoryOption
                active={activeIndex === index + 1}
                category={category}
                key={category.id}
                onFocus={() => setActiveIndex(index + 1)}
                onSelect={() => chooseCategory(category.id)}
                selected={category.id === selectedId}
                variant={variant}
              />
            ))}
            {onCreateCategory ? (
              <button
                aria-selected="false"
                className={variant === "timer"
                  ? "swiss-category-option category-picker-create-option"
                  : `category-picker-create-option${activeIndex === optionValues.length - 1 ? " is-active" : ""}`}
                onClick={beginCreate}
                onFocus={() => setActiveIndex(optionValues.length - 1)}
                ref={createOptionRef}
                role="option"
                type="button"
              >
                <Plus aria-hidden="true" size={15} />
                <span>Create new category</span>
              </button>
            ) : null}
          </div>
        )}
      </div>)}
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
      <span>{category?.name ?? "Uncategorized"}</span>
      {selected
        ? variant === "timer"
          ? <CheckCircle2 aria-hidden="true" size={14} />
          : <Check aria-hidden="true" size={15} />
        : null}
    </button>
  );
}
