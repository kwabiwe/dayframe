"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { InlineTagInput } from "@/components/InlineTagInput";
import { Button, Field, ModalDialog, SelectField } from "@/components/ui/Primitives";
import { clientFetch } from "@/lib/client-auth-fetch";
import type { CategoryRow, PlaceRow, TagRow, TimeEntryRow } from "@/lib/queries";
import {
  dateTimeLocal,
  dateTimeLocalInputToIso,
  durationInputValue,
  parseDurationInput
} from "@/lib/format";

export function EditTimeEntryDialog({
  categories,
  entry,
  onClose,
  onSaved,
  places,
  tags
}: {
  categories: CategoryRow[];
  entry: TimeEntryRow;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  places: PlaceRow[];
  tags: TagRow[];
}) {
  const [isBusy, setIsBusy] = useState(false);
  const isCompletedEntry = Boolean(entry.stoppedAt);
  const initialDurationSeconds = entry.stoppedAt
    ? Math.max(
        0,
        Math.round((new Date(entry.stoppedAt).getTime() - new Date(entry.startedAt).getTime()) / 1000)
      )
    : entry.durationSeconds;
  const [startedAtDraft, setStartedAtDraft] = useState(() => dateTimeLocal(new Date(entry.startedAt)));
  const [stoppedAtDraft, setStoppedAtDraft] = useState(() =>
    entry.stoppedAt ? dateTimeLocal(new Date(entry.stoppedAt)) : ""
  );
  const [durationDraft, setDurationDraft] = useState(() => durationInputValue(initialDurationSeconds));
  const [durationEdited, setDurationEdited] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState(entry.description ?? "");
  const [selectedTagNames, setSelectedTagNames] = useState(entry.tagNames);
  const formId = `edit-time-entry-${entry.id}`;

  function syncDurationFromTimes(nextStartedAtDraft: string, nextStoppedAtDraft: string) {
    if (!isCompletedEntry) return;
    const startedAt = dateTimeLocalInputToIso(nextStartedAtDraft);
    const stoppedAt = dateTimeLocalInputToIso(nextStoppedAtDraft);
    if (!startedAt || !stoppedAt) return;

    const nextDurationSeconds = Math.round(
      (new Date(stoppedAt).getTime() - new Date(startedAt).getTime()) / 1000
    );
    if (nextDurationSeconds > 0) setDurationDraft(durationInputValue(nextDurationSeconds));
  }

  function syncStoppedAtFromDuration(nextDurationDraft = durationDraft, nextStartedAtDraft = startedAtDraft) {
    if (!isCompletedEntry) return;
    const durationSeconds = parseDurationInput(nextDurationDraft);
    const startedAt = dateTimeLocalInputToIso(nextStartedAtDraft);
    if (!durationSeconds || !startedAt) return;

    const stoppedAt = new Date(new Date(startedAt).getTime() + durationSeconds * 1000);
    setStoppedAtDraft(dateTimeLocal(stoppedAt));
  }

  function updateStartedAtDraft(nextStartedAtDraft: string) {
    setStartedAtDraft(nextStartedAtDraft);
    if (durationEdited) {
      syncStoppedAtFromDuration(durationDraft, nextStartedAtDraft);
      return;
    }
    syncDurationFromTimes(nextStartedAtDraft, stoppedAtDraft);
  }

  function updateStoppedAtDraft(nextStoppedAtDraft: string) {
    setStoppedAtDraft(nextStoppedAtDraft);
    setDurationEdited(false);
    syncDurationFromTimes(startedAtDraft, nextStoppedAtDraft);
  }

  function updateDurationDraft(nextDurationDraft: string, form: HTMLFormElement | null) {
    setDurationDraft(nextDurationDraft);
    setDurationEdited(true);
    const startField = form?.elements.namedItem("startedAt");
    syncStoppedAtFromDuration(
      nextDurationDraft,
      startField instanceof HTMLInputElement ? startField.value : startedAtDraft
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const formData = new FormData(event.currentTarget);

    const startedAt = dateTimeLocalInputToIso(formData.get("startedAt"));
    if (!startedAt) {
      setFormError("Use a valid start time.");
      return;
    }

    let stoppedAt: string | null = null;
    if (isCompletedEntry) {
      if (durationEdited) {
        const durationValue = formData.get("duration");
        const durationSeconds = parseDurationInput(typeof durationValue === "string" ? durationValue : "");
        if (!durationSeconds) {
          setFormError("Use a valid positive duration, for example 1:15 or 75m.");
          return;
        }
        stoppedAt = new Date(new Date(startedAt).getTime() + durationSeconds * 1000).toISOString();
      } else {
        stoppedAt = dateTimeLocalInputToIso(formData.get("stoppedAt"));
        if (!stoppedAt) {
          setFormError("Use a valid finish time.");
          return;
        }
      }

      if (new Date(startedAt).getTime() >= new Date(stoppedAt).getTime()) {
        setFormError("Finish time must be after start time.");
        return;
      }
    }

    setIsBusy(true);
    try {
      const response = await clientFetch(`/api/time-entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: formData.get("categoryId") || null,
          placeId: formData.get("placeId") || null,
          description: formData.get("description") || null,
          tagNames: selectedTagNames,
          startedAt,
          stoppedAt
        })
      });
      if (!response.ok) {
        let errorMessage = `Unable to update entry: ${response.status}`;
        try {
          const payload = (await response.json()) as { error?: string };
          errorMessage = payload.error ?? errorMessage;
        } catch {
          // Runtime failures may not return JSON.
        }
        throw new Error(errorMessage);
      }
      await onSaved();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to update this time block.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <ModalDialog
      busy={isBusy}
      onClose={onClose}
      title="Edit time block"
      footer={(
        <>
          <Button onClick={onClose} disabled={isBusy}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={isBusy}>Save</Button>
        </>
      )}
    >
      <form id={formId} className="swiss-form-grid" onSubmit={submit}>
          <SelectField
            id={`${formId}-category`}
            name="categoryId"
            label="Category"
            defaultValue={entry.categoryId ?? ""}
            options={[
              { value: "", label: "Uncategorized" },
              ...categories.map((category) => ({ value: category.id, label: category.name }))
            ]}
          />
          <SelectField
            id={`${formId}-place`}
            name="placeId"
            label="Place"
            defaultValue={entry.placeId ?? ""}
            options={[
              { value: "", label: "No place" },
              ...places.map((place) => ({ value: place.id, label: place.name }))
            ]}
          />
          <Field className="swiss-form-wide" htmlFor="edit-entry-description" label="Description">
            <InlineTagInput
              ariaLabel="Time entry description"
              inputClassName="ui-control"
              inputId="edit-entry-description"
              name="description"
              onChange={setDescriptionDraft}
              onSelectedTagNamesChange={setSelectedTagNames}
              placeholder="What are you working on?"
              selectedTagNames={selectedTagNames}
              tags={tags}
              value={descriptionDraft}
            />
          </Field>
          <Field htmlFor={`${formId}-start`} label="Start">
            <input
              id={`${formId}-start`}
              className="ui-control"
              type="datetime-local"
              name="startedAt"
              value={startedAtDraft}
              onChange={(event) => updateStartedAtDraft(event.target.value)}
              onInput={(event) => updateStartedAtDraft(event.currentTarget.value)}
              onBlur={() => {
                if (durationEdited) syncStoppedAtFromDuration();
              }}
              required
            />
          </Field>
          {isCompletedEntry ? (
            <>
              <Field htmlFor={`${formId}-finish`} label="Finish">
                <input
                  id={`${formId}-finish`}
                  className="ui-control"
                  type="datetime-local"
                  name="stoppedAt"
                  value={stoppedAtDraft}
                  onChange={(event) => updateStoppedAtDraft(event.target.value)}
                  onInput={(event) => updateStoppedAtDraft(event.currentTarget.value)}
                  required
                />
              </Field>
              <Field htmlFor={`${formId}-duration`} label="Duration">
                <input
                  id={`${formId}-duration`}
                  className="ui-control is-compact"
                  name="duration"
                  value={durationDraft}
                  onChange={(event) => updateDurationDraft(event.target.value, event.currentTarget.form)}
                  onInput={(event) => updateDurationDraft(event.currentTarget.value, event.currentTarget.form)}
                  onBlur={() => syncStoppedAtFromDuration()}
                  placeholder="1:15"
                />
              </Field>
            </>
          ) : null}
          {formError ? (
            <p className="swiss-inline-error swiss-form-wide" role="alert">
              {formError}
            </p>
          ) : null}
      </form>
    </ModalDialog>
  );
}
