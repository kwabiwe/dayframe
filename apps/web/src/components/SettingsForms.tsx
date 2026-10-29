"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";
import { ChevronDown } from "lucide-react";
import { useAppShellRuntime } from "@/components/AppShellRuntime";
import { SignOutControl } from "@/components/SignOutControl";
import {
  Button,
  Disclosure,
  ModalDialog,
  SettingsRow,
  TextField
} from "@/components/ui/Primitives";
import { clientFetch } from "@/lib/client-auth-fetch";
import { OPEN_SHORTCUTS_EVENT } from "@/lib/shell-nav";
import { beforeSessionChange } from "@/lib/session-change";

type SettingsAuthMode = "dev" | "local" | "provider" | "token";

type AccountSettingsProps = {
  authMode: SettingsAuthMode;
  /**
   * The last account change that succeeded, held by the page so it survives this card being
   * re-created after a workspace switch or create.
   */
  notice?: string | null;
  onNotice?: (message: string | null) => void;
  user: { email: string; name: string };
  workspace: { id: string; name: string };
  workspaces: Array<{ id: string; name: string }>;
};

export function AccountSettings({
  authMode,
  notice = null,
  onNotice,
  user,
  workspace,
  workspaces
}: AccountSettingsProps) {
  const router = useRouter();
  const { refresh } = useAppShellRuntime();
  const [name, setName] = useState(user.name);
  const [workspaceName, setWorkspaceName] = useState(workspace.name);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [workspaceAction, setWorkspaceAction] = useState<"create" | "rename" | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  // The account card's dialogs: Edit profile, Switch workspace, Change password.
  const [dialog, setDialog] = useState<"profile" | "workspace" | "password" | null>(null);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const message = onNotice ? notice : localMessage;
  const setMessage = useCallback((next: string | null) => (onNotice ? onNotice(next) : setLocalMessage(next)), [onNotice]);
  const [error, setError] = useState<string | null>(null);

  async function run(actionName: string, action: () => Promise<void>) {
    if (busyAction) return;
    setBusyAction(actionName);
    setMessage(null);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save your account settings.");
    } finally {
      setBusyAction(null);
    }
  }

  async function refreshAccount() {
    await refresh({ force: true });
    router.refresh();
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter your name.");
      return;
    }
    void run("profile", async () => {
      const response = await clientFetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName })
      });
      if (!response.ok) throw new Error(await safeResponseMessage(response, "Unable to save your profile."));
      setMessage("Profile saved.");
      setDialog(null);
      await refreshAccount();
    });
  }

  function renameWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = workspaceName.trim();
    if (!trimmedName) {
      setError("Enter a workspace name.");
      return;
    }
    void run("rename-workspace", async () => {
      const response = await clientFetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceName: trimmedName })
      });
      if (!response.ok) throw new Error(await safeResponseMessage(response, "Unable to rename this workspace."));
      setMessage("Workspace name saved.");
      setWorkspaceAction(null);
      setDialog(null);
      await refreshAccount();
    });
  }

  function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = newWorkspaceName.trim();
    if (!trimmedName) {
      setError("Enter a name for the new workspace.");
      return;
    }
    void run("create-workspace", async () => {
      // The new workspace becomes the current one: held Review decisions save first.
      await beforeSessionChange();
      const response = await clientFetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName })
      });
      if (!response.ok) throw new Error(await safeResponseMessage(response, "Unable to create a workspace."));
      setNewWorkspaceName("");
      setMessage("Workspace created and selected.");
      setWorkspaceAction(null);
      setDialog(null);
      await refreshAccount();
    });
  }

  function switchWorkspace(workspaceId: string, nextWorkspaceName: string) {
    void run("switch-workspace", async () => {
      // Held Review decisions are saved under the workspace they were made in.
      await beforeSessionChange();
      const response = await clientFetch("/api/workspace/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId })
      });
      if (!response.ok) throw new Error(await safeResponseMessage(response, "Unable to switch workspace."));
      setWorkspaceName(nextWorkspaceName);
      setMessage(`Switched to ${nextWorkspaceName}.`);
      setDialog(null);
      await refreshAccount();
    });
  }

  function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    void run("password", async () => {
      const response = await clientFetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      if (!response.ok) throw new Error(await safeResponseMessage(response, "Unable to change your password."));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Password changed.");
      setDialog(null);
    });
  }

  const canChangePassword = authMode === "local" || authMode === "provider";
  const closeDialog = () => {
    if (busyAction) return;
    setDialog(null);
    setError(null);
    setWorkspaceAction(null);
  };
  const dialogError = dialog && error ? <p className="settings-section-feedback is-error" role="alert">{error}</p> : null;

  return (
    <section className="df-card df-set-account" aria-label="Account" id="account">
      <span className="df-av-lg" aria-hidden="true">{initials(user.name)}</span>
      <span className="df-set-id">
        <b>{user.name}</b>
        <small>{user.email} · {workspace.name}</small>
      </span>
      <span className="df-set-acts">
        <button className="df-rbtn df-rbtn--sm" onClick={() => setDialog("profile")} type="button">
          Edit profile
        </button>
        <button className="df-rbtn df-rbtn--sm" onClick={() => setDialog("workspace")} type="button">
          {workspaces.length > 1 ? "Switch workspace" : "Workspace"}
        </button>
        {canChangePassword ? (
          <button className="df-rbtn df-rbtn--sm df-rbtn--ghost" onClick={() => setDialog("password")} type="button">
            Change password
          </button>
        ) : null}
      </span>
      {message && !dialog ? <p className="settings-section-feedback df-set-feedback" role="status">{message}</p> : null}
      {error && !dialog ? <p className="settings-section-feedback is-error df-set-feedback" role="alert">{error}</p> : null}

      {dialog === "profile" ? (
        <ModalDialog
          size="compact"
          busy={busyAction === "profile"}
          description={user.email}
          // The action sits in the dialog's footer, like every confirmation (UIA-301).
          footer={(
            <>
              <Button variant="ghost" compact disabled={Boolean(busyAction)} onClick={closeDialog} type="button">Cancel</Button>
              <Button compact disabled={Boolean(busyAction)} form="settings-profile-form" type="submit" variant="primary">
                {busyAction === "profile" ? "Saving…" : "Save profile"}
              </Button>
            </>
          )}
          onClose={closeDialog}
          title="Edit profile"
        >
          <form className="df-set-dialog-form" id="settings-profile-form" onSubmit={saveProfile}>
            <TextField
              compact
              id="settings-profile-name"
              label="Name"
              maxLength={120}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </form>
          {dialogError}
        </ModalDialog>
      ) : null}

      {dialog === "workspace" ? (
        <ModalDialog size="compact" busy={Boolean(busyAction)} description={`Currently using ${workspace.name}`} onClose={closeDialog} title="Workspace">
          <div className="settings-workspace-actions df-set-dialog-workspace">
            <div className="settings-workspace-toolbar">
              <label className="settings-workspace-select">
                <span className="sr-only">Active workspace</span>
                <select
                  aria-label="Workspace"
                  className="ui-control"
                  disabled={Boolean(busyAction)}
                  value={workspace.id}
                  onChange={(event) => {
                    const nextWorkspace = workspaces.find((item) => item.id === event.target.value);
                    if (nextWorkspace) switchWorkspace(nextWorkspace.id, nextWorkspace.name);
                  }}
                >
                  {workspaces.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
                <ChevronDown aria-hidden="true" size={16} />
              </label>
              <Button
                aria-expanded={workspaceAction === "rename"}
                compact
                onClick={() => setWorkspaceAction((current) => current === "rename" ? null : "rename")}
                type="button"
              >
                Rename
              </Button>
              <Button
                aria-expanded={workspaceAction === "create"}
                compact
                onClick={() => setWorkspaceAction((current) => current === "create" ? null : "create")}
                type="button"
              >
                New workspace
              </Button>
            </div>
            {workspaceAction === "rename" ? <form className="settings-inline-form settings-workspace-detail-form" onSubmit={renameWorkspace}>
              <TextField
                compact
                id="settings-workspace-name"
                label="Workspace name"
                maxLength={120}
                required
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
              />
              <Button compact type="submit" disabled={Boolean(busyAction)}>
                {busyAction === "rename-workspace" ? "Saving…" : "Save name"}
              </Button>
              <Button variant="ghost" compact type="button" onClick={() => setWorkspaceAction(null)}>Cancel</Button>
            </form> : null}
            {workspaceAction === "create" ? <form className="settings-inline-form settings-workspace-detail-form" onSubmit={createWorkspace}>
              <TextField
                compact
                id="settings-new-workspace-name"
                label="New workspace"
                maxLength={120}
                placeholder="Workspace name"
                required
                value={newWorkspaceName}
                onChange={(event) => setNewWorkspaceName(event.target.value)}
              />
              <Button compact type="submit" disabled={Boolean(busyAction)}>
                {busyAction === "create-workspace" ? "Creating…" : "Create"}
              </Button>
              <Button variant="ghost" compact type="button" onClick={() => setWorkspaceAction(null)}>Cancel</Button>
            </form> : null}
            {dialogError}
          </div>
        </ModalDialog>
      ) : null}

      {dialog === "password" && canChangePassword ? (
        <ModalDialog
          size="compact"
          busy={busyAction === "password"}
          description={securitySummary(authMode)}
          footer={(
            <>
              <Button variant="ghost" compact disabled={Boolean(busyAction)} onClick={closeDialog} type="button">Cancel</Button>
              <Button compact disabled={Boolean(busyAction)} form="settings-password-form" type="submit" variant="primary">
                {busyAction === "password" ? "Saving…" : "Change password"}
              </Button>
            </>
          )}
          onClose={closeDialog}
          title="Change password"
        >
          <form className="df-set-dialog-form" id="settings-password-form" onSubmit={changePassword}>
            <TextField
              compact
              autoComplete="current-password"
              id="settings-current-password"
              label="Current password"
              required
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
            <TextField
              compact
              autoComplete="new-password"
              id="settings-new-password"
              label="New password"
              minLength={8}
              required
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <TextField
              compact
              autoComplete="new-password"
              id="settings-confirm-password"
              label="Confirm password"
              minLength={8}
              required
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </form>
          {dialogError}
        </ModalDialog>
      ) : null}
    </section>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export function PlacesLocationSettings() {
  return (
    <>
      <SettingsRow
        glyph="map-pin"
        label="Saved places"
        detail="Places Dayframe recognises."
        action={<Link className="df-rbtn df-rbtn--sm" href="/places">Manage</Link>}
      />
      <TripLoggingSetting />
    </>
  );
}

/** "Log trips automatically" for the signed-in account; a different account gets a fresh switch. */
function TripLoggingSetting() {
  const { data, refresh } = useAppShellRuntime();
  if (!data) return null;
  return (
    <TripLoggingSwitch
      key={data.user.id}
      refresh={refresh}
      revision={data.user.goalsRevision ?? 0}
      stored={data.user.logTripsAutomatically ?? false}
      userId={data.user.id}
    />
  );
}

/**
 * "Log trips automatically" (PRD D19, A4; on by default): a Move between two known places with a clear
 * way of travelling becomes a block without a Review card. The switch moves at once; once the server
 * stores it, that value shows until a bootstrap read after the write arrives: the server orders the
 * switch with the goals (`goalsRevision`), so a copy read before the save, or kept by a local timer
 * update, never replaces it (Codex r1–r4 on #462). A refused save puts it back and says why.
 */
export function TripLoggingSwitch({ refresh, revision, stored, userId }: {
  refresh: (options?: { force?: boolean }) => Promise<unknown>;
  /** The server revision of the bootstrap `stored` came from (`user.goalsRevision`). */
  revision: number;
  stored: boolean;
  userId: string;
}) {
  const [pending, setPending] = useState<boolean | null>(null);
  const [saved, setSaved] = useState<{ value: boolean; revision: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checked = pending ?? (saved && revision < saved.revision ? saved.value : stored);

  async function save(next: boolean) {
    if (pending !== null) return;
    setPending(next);
    setError(null);
    try {
      const response = await clientFetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logTripsAutomatically: next, expectedUserId: userId })
      });
      if (!response.ok) throw new Error(await safeResponseMessage(response, "Unable to save this setting."));
      const body = (await response.json().catch(() => ({}))) as { logTripsAutomatically?: unknown; settingsRevision?: unknown };
      setSaved({
        value: typeof body.logTripsAutomatically === "boolean" ? body.logTripsAutomatically : next,
        // Without a revision (an older server) the saved value holds until any newer revision.
        revision: typeof body.settingsRevision === "number" ? body.settingsRevision : revision + 1
      });
      try {
        await refresh({ force: true });
      } catch {
        // The saved value still shows; the next bootstrap brings the rest.
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save this setting.");
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <label className="place-suggestion-toggle df-set-trips">
        <span>
          <strong>Log trips automatically</strong>
          <small id="df-set-trips-hint">When it’s clear how you travelled between your places.</small>
        </span>
        <input
          aria-describedby="df-set-trips-hint"
          aria-label="Log trips automatically"
          checked={checked}
          disabled={pending !== null}
          onChange={(event) => void save(event.target.checked)}
          role="switch"
          type="checkbox"
        />
      </label>
      {error ? <p className="settings-section-feedback is-error" role="alert">{error}</p> : null}
    </>
  );
}

export function DataPrivacySettings() {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function deleteEvidence() {
    if (deleting) return;
    setDeleting(true);
    setMessage(null);
    setError(null);
    try {
      const response = await clientFetch("/api/location/evidence", { method: "DELETE" });
      if (!response.ok) throw new Error("Unable to delete recent location evidence.");
      const payload = (await response.json()) as { deletedEvidenceCount?: number };
      const count = payload.deletedEvidenceCount ?? 0;
      setConfirmDelete(false);
      setMessage(count === 1 ? "Deleted 1 recent location evidence item." : `Deleted ${count} recent location evidence items.`);
    } catch {
      setError("Unable to delete recent location evidence. Check your connection and try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <SettingsRow
        glyph="download"
        label="Export data"
        detail="All your data in one file."
        action={(
          // UIA-312: one Export; the spreadsheet and the raw history sit in a small menu beside it.
          <div className="df-export">
            <a className="df-rbtn df-rbtn--sm" href="/api/export?kind=workspace_json" download>Export</a>
            <details className="df-export-more">
              <summary className="df-rbtn df-rbtn--sm df-rbtn--ghost" aria-label="More export formats">More formats</summary>
              <div className="df-export-menu">
                <a href="/api/export?kind=time_entries_csv" download>Blocks as a spreadsheet (CSV)</a>
                <a href="/api/export?kind=activity_events_json" download>Activity history (JSON)</a>
              </div>
            </details>
          </div>
        )}
      />
      <SettingsRow
        glyph="trash-2"
        label="Recent location evidence"
        detail="Raw location is deleted after 7 days. Blocks and saved places stay."
        action={(
          <Button variant="danger" compact onClick={() => setConfirmDelete(true)}>
            Delete recent evidence
          </Button>
        )}
      />
      {message ? <p className="settings-section-feedback" role="status">{message}</p> : null}
      {error ? <p className="settings-section-feedback is-error" role="alert">{error}</p> : null}
      {confirmDelete ? (
        <ModalDialog
          busy={deleting}
          description="This removes recent raw location evidence for your current account and workspace."
          footer={(
            <>
              <Button variant="ghost" disabled={deleting} onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button variant="danger" disabled={deleting} onClick={() => void deleteEvidence()}>
                {deleting ? "Deleting…" : "Delete evidence"}
              </Button>
            </>
          )}
          onClose={() => setConfirmDelete(false)}
          role="alertdialog"
          title="Delete recent location evidence?"
        >
          <div className="settings-confirm-copy">
            <p>Confirmed blocks and saved places will remain.</p>
            <p>This cannot be undone.</p>
          </div>
        </ModalDialog>
      ) : null}
    </>
  );
}

/**
 * Settings › Help: keyboard shortcuts, and what to try when something looks wrong. Things to check are answered in
 * Calendar › List (location v4 step 15), so Help no longer links to a Review page.
 */
export function HelpSettings({ authMode }: { authMode: SettingsAuthMode }) {
  return (
    <>
      <SettingsRow
        className="df-shortcuts-row"
        label="Keyboard shortcuts"
        detail="Start, stop, jump between pages and more."
        action={(
          <button className="df-rbtn df-rbtn--sm" onClick={() => window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT))} type="button">
            Show
          </button>
        )}
      />
      <Disclosure summary="Something not right?">
        <div className="settings-troubleshooting-copy">
          <p>{securitySummary(authMode)}</p>
          <p>Recent raw location evidence is private and normally deleted after seven days.</p>
          <p>If Dayframe looks out of date, refresh this page. If that does not help, sign out and sign in again.</p>
        </div>
      </Disclosure>
    </>
  );
}

/** The page's own Sign out, under the cards (the profile menu has another). */
export function SettingsSignOut() {
  return <SignOutControl className="df-rbtn df-set-signout" />;
}

function securitySummary(authMode: SettingsAuthMode) {
  switch (authMode) {
    case "local":
      return "Email and password are managed by this Dayframe server.";
    case "provider":
      return "Change the password used to sign in to Dayframe.";
    case "token":
      return "This session uses a scoped Dayframe app connection.";
    case "dev":
      return "This local build uses Dayframe’s developer sign-in.";
  }
}

async function safeResponseMessage(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: string };
    const message = payload.error?.trim();
    if (
      message &&
      message.length <= 160 &&
      !/(sql|postgres|relation|column|stack|bearer|token|\/api\/|dayframe_)/i.test(message)
    ) {
      return message;
    }
  } catch {
    // The fallback below is intentionally user-safe.
  }
  return fallback;
}
