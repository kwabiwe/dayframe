"use client";

import Link from "next/link";
import { Briefcase, House, Plus } from "lucide-react";
import { useRef, useState } from "react";
import {
  initialPreviousPlaceName,
  placeChoiceLabel,
  placeRoleLabel,
  placeRoleRequest,
  placeRoleSlots,
  type PlaceRole
} from "@dayframe/shared";
import type { PlaceRow } from "@/lib/queries";
import { clientFetch } from "@/lib/client-auth-fetch";
import { Button, ModalDialog, SelectField, TextField } from "./ui/Primitives";

type Editing = {
  role: PlaceRole;
  targetId: string;
  previousPlaceName: string;
  /** Once the person types a name, choosing another place no longer replaces it. */
  renameTouched: boolean;
  mode: "choose" | "clear";
};

const ROLE_ICONS = { home: House, work: Briefcase } as const;

/**
 * The two pinned Home and Work slots at the top of Places. A slot points at a saved place;
 * changing it moves only the role, so entries stay on the place they were recorded at.
 */
export function PlaceRoleSlots({
  places,
  onChanged
}: {
  places: PlaceRow[];
  onChanged: (message: string) => void;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const slots = placeRoleSlots(places);
  const editingSlot = editing ? slots.find((slot) => slot.role === editing.role) ?? null : null;
  const holder = editingSlot?.previousHolder ?? null;
  const targetId = editing?.mode === "clear" ? null : editing?.targetId || null;
  const chosenPlace = targetId ? places.find((place) => place.id === targetId) ?? null : null;
  const chosenOtherRole = chosenPlace?.role && chosenPlace.role !== editing?.role ? chosenPlace.role : null;
  const roleLeavesHolder = Boolean(holder && (editing?.mode === "clear" || (targetId && targetId !== holder.id)));

  function open(role: PlaceRole, mode: Editing["mode"]) {
    const slot = slots.find((candidate) => candidate.role === role);
    const current = slot?.place ?? null;
    setError(null);
    setEditing({
      role,
      mode,
      targetId: mode === "clear" ? "" : current?.id ?? "",
      previousPlaceName: initialPreviousPlaceName(role, slot?.previousHolder ?? null, mode === "clear" ? null : current),
      renameTouched: false
    });
  }

  async function save() {
    if (!editing || !editingSlot || savingRef.current) return;
    if (editing.mode === "choose" && !editing.targetId) {
      setError("Choose a saved place.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await clientFetch("/api/places/role", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(placeRoleRequest({
          role: editing.role,
          targetId,
          holder,
          previousPlaceName: editing.previousPlaceName
        }))
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `Unable to update ${editingSlot.label}.`);
      }
      setEditing(null);
      onChanged(targetId ? `${editingSlot.label} updated.` : `${editingSlot.label} cleared.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Unable to update ${editingSlot.label}.`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="places-list-section" aria-labelledby="place-roles-heading">
      <header>
        <div>
          <h2 id="place-roles-heading">Home and Work</h2>
          <p>Trips and time away are named after these.</p>
        </div>
      </header>
      <div className="places-list">
        {slots.map((slot) => {
          const Icon = ROLE_ICONS[slot.role];
          return (
            <article className="place-list-row place-role-slot" key={slot.role}>
              <span className="place-list-icon"><Icon aria-hidden="true" size={19} /></span>
              <div className="place-list-copy">
                <h3>{slot.label}</h3>
                <p>{slot.place ? slot.secondary ?? `${slot.place.radiusMeters}m radius` : "Not set"}</p>
              </div>
              <div className="place-list-actions">
                {slot.place ? (
                  <>
                    <Button compact variant="secondary" aria-label={`Change ${slot.label}`} onClick={() => open(slot.role, "choose")}>
                      Change
                    </Button>
                    <Button compact variant="ghost" aria-label={`Clear ${slot.label}`} onClick={() => open(slot.role, "clear")}>
                      Clear
                    </Button>
                  </>
                ) : places.length === 0 ? (
                  // Nothing saved to choose from yet: go straight to adding the place.
                  <Link className="ui-button ui-button-secondary is-compact" href={`/places/new?role=${slot.role}`}>
                    Set {slot.label}
                  </Link>
                ) : (
                  <Button compact variant="secondary" onClick={() => open(slot.role, "choose")}>
                    Set {slot.label}
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {editing && editingSlot ? (
        <ModalDialog
          busy={saving}
          title={editing.mode === "clear" ? `Clear ${editingSlot.label}?` : `Set ${editingSlot.label}`}
          description={editing.mode === "clear"
            ? `The place stays saved and keeps its entries; it just stops being ${editingSlot.label}.`
            : `Choose the saved place that is your ${editingSlot.label.toLowerCase()}. Past entries stay where they were recorded.`}
          footer={(
            <>
              <Button disabled={saving} onClick={() => setEditing(null)}>Cancel</Button>
              <Button disabled={saving} variant={editing.mode === "clear" ? "danger" : "primary"} onClick={() => void save()}>
                {saving ? "Saving…" : editing.mode === "clear" ? "Clear" : "Save"}
              </Button>
            </>
          )}
          onClose={() => setEditing(null)}
        >
          <div className="place-role-dialog">
            {editing.mode === "choose" ? (
              <>
                <SelectField
                  id="place-role-target"
                  label={`${editingSlot.label} place`}
                  options={[
                    { value: "", label: "Choose a saved place" },
                    ...places.map((place) => ({ value: place.id, label: placeChoiceLabel(place) }))
                  ]}
                  value={editing.targetId}
                  onChange={(event) => {
                    const next = event.target.value;
                    const target = places.find((candidate) => candidate.id === next) ?? null;
                    setEditing((current) => current ? {
                      ...current,
                      targetId: next,
                      previousPlaceName: current.renameTouched
                        ? current.previousPlaceName
                        : initialPreviousPlaceName(current.role, holder, target)
                    } : current);
                  }}
                />
                {chosenOtherRole ? (
                  <p className="place-role-note" role="note">
                    This place is your {placeRoleLabel(chosenOtherRole)}, so {placeRoleLabel(chosenOtherRole)} will be empty.
                  </p>
                ) : null}
                <Link className="place-role-new-link" href={`/places/new?role=${editing.role}`}>
                  <Plus aria-hidden="true" size={16} />
                  Add a new place as {editingSlot.label}
                </Link>
              </>
            ) : null}
            {holder && roleLeavesHolder ? (
              <TextField
                id="place-role-previous-name"
                label={editing.mode === "clear" ? "Name for this place" : `Rename the old ${editingSlot.label.toLowerCase()}`}
                help="Its past entries keep this name, so they don't read as an address. Leave it blank to keep the current name."
                maxLength={120}
                value={editing.previousPlaceName}
                onChange={(event) => {
                  const previousPlaceName = event.target.value;
                  setEditing((current) => current ? { ...current, previousPlaceName, renameTouched: true } : current);
                }}
              />
            ) : null}
            {error ? <p className="place-editor-status is-error" role="alert">{error}</p> : null}
          </div>
        </ModalDialog>
      ) : null}
    </section>
  );
}
