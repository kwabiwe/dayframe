"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  Download,
  Folder,
  LogOut,
  MapPin,
  ShieldCheck,
  Trash2,
  UserRound
} from "lucide-react";
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

type SettingsAuthMode = "dev" | "local" | "provider" | "token";

type AccountSettingsProps = {
  authMode: SettingsAuthMode;
  user: { email: string; name: string };
  workspace: { id: string; name: string };
  workspaces: Array<{ id: string; name: string }>;
};

export function AccountSettings({
  authMode,
  user,
  workspace,
  workspaces
}: AccountSettingsProps) {
  const router = useRouter();
  const { refresh } = useAppShellRuntime();
  const [name, setName] = useState(user.name);
  const [workspaceName, setWorkspaceName] = useState(workspace.name);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
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
      const response = await clientFetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName })
      });
      if (!response.ok) throw new Error(await safeResponseMessage(response, "Unable to create a workspace."));
      setNewWorkspaceName("");
      setMessage("Workspace created and selected.");
      await refreshAccount();
    });
  }

  function switchWorkspace(workspaceId: string, nextWorkspaceName: string) {
    void run("switch-workspace", async () => {
      const response = await clientFetch("/api/workspace/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId })
      });
      if (!response.ok) throw new Error(await safeResponseMessage(response, "Unable to switch workspace."));
      setWorkspaceName(nextWorkspaceName);
      setMessage(`Switched to ${nextWorkspaceName}.`);
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
    });
  }

  return (
    <>
      <SettingsRow
        icon={UserRound}
        label="Profile"
        detail={user.email}
        action={(
          <form className="settings-inline-form" onSubmit={saveProfile}>
            <TextField
              compact
              id="settings-profile-name"
              label="Name"
              maxLength={120}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Button variant="primary" compact type="submit" disabled={Boolean(busyAction)}>
              {busyAction === "profile" ? "Saving…" : "Save profile"}
            </Button>
          </form>
        )}
      />
      <SettingsRow
        icon={Folder}
        label="Workspace"
        detail={`Currently using ${workspace.name}`}
        action={(
          <div className="settings-workspace-actions">
            <div className="settings-workspace-switcher" aria-label="Available workspaces">
              {workspaces.map((item) => {
                const selected = item.id === workspace.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={Boolean(busyAction) || selected}
                    onClick={() => switchWorkspace(item.id, item.name)}
                  >
                    <span>{item.name}</span>
                    {selected ? <CheckCircle2 size={15} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
            <form className="settings-inline-form" onSubmit={renameWorkspace}>
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
                {busyAction === "rename-workspace" ? "Saving…" : "Rename"}
              </Button>
            </form>
            <form className="settings-inline-form" onSubmit={createWorkspace}>
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
            </form>
          </div>
        )}
      />
      <SettingsRow
        icon={ShieldCheck}
        label="Security"
        detail={securitySummary(authMode)}
        action={authMode === "local" ? (
          <form className="settings-security-form" onSubmit={changePassword}>
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
            <Button compact variant="primary" type="submit" disabled={Boolean(busyAction)}>
              {busyAction === "password" ? "Saving…" : "Change password"}
            </Button>
          </form>
        ) : undefined}
      />
      <SettingsRow
        icon={LogOut}
        label="Sign out"
        detail="End this Dayframe session on this browser."
        action={<SignOutControl className="ui-button ui-button-secondary" />}
      />
      {message ? <p className="settings-section-feedback" role="status">{message}</p> : null}
      {error ? <p className="settings-section-feedback is-error" role="alert">{error}</p> : null}
    </>
  );
}

export function PlacesLocationSettings() {
  return (
    <>
      <SettingsRow
        icon={MapPin}
        label="Places"
        detail="Manage saved places and the visit suggestions attached to them."
        action={<Link className="ui-button ui-button-secondary" href="/places">Manage places</Link>}
      />
      <SettingsRow
        label="Suggest visits"
        detail="Visit suggestions are controlled for each saved place. Background visit detection is managed in the iPhone app."
      />
      <LocationAccessRow />
    </>
  );
}

function LocationAccessRow() {
  const [permission, setPermission] = useState("Check this browser’s site settings.");

  useEffect(() => {
    let active = true;
    let status: PermissionStatus | null = null;

    function update(nextState: PermissionState) {
      if (!active) return;
      setPermission(permissionCopy(nextState));
    }

    if (!navigator.permissions?.query) {
      return () => {
        active = false;
      };
    }

    void navigator.permissions.query({ name: "geolocation" }).then((nextStatus) => {
      status = nextStatus;
      update(nextStatus.state);
      nextStatus.addEventListener("change", handlePermissionChange);
    }).catch(() => {
      if (active) setPermission("Check this browser’s site settings.");
    });

    function handlePermissionChange() {
      if (status) update(status.state);
    }

    return () => {
      active = false;
      status?.removeEventListener("change", handlePermissionChange);
      status = null;
    };
  }, []);

  return (
    <SettingsRow
      label="Location access"
      detail={`${permission} Dayframe only asks for browser location when you choose Current location while editing a place.`}
    />
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
        icon={Download}
        label="Export data"
        detail="Download a copy of your Dayframe information."
        action={(
          <div className="settings-export-actions">
            <a className="ui-button ui-button-secondary" href="/api/export?kind=workspace_json" download>Dayframe data</a>
            <a className="ui-button ui-button-secondary" href="/api/export?kind=time_entries_csv" download>Time entries</a>
            <a className="ui-button ui-button-secondary" href="/api/export?kind=activity_events_json" download>Activity history</a>
          </div>
        )}
      />
      <SettingsRow
        icon={Trash2}
        label="Recent location evidence"
        detail="Raw map evidence is normally deleted after seven days. Confirmed time entries and saved places are kept."
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
              <Button disabled={deleting} onClick={() => setConfirmDelete(false)}>Cancel</Button>
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
            <p>Confirmed time entries and saved places will remain.</p>
            <p>This cannot be undone.</p>
          </div>
        </ModalDialog>
      ) : null}
    </>
  );
}

export function TroubleshootingSettings({ authMode }: { authMode: SettingsAuthMode }) {
  return (
    <Disclosure summary="Privacy and troubleshooting">
      <div className="settings-troubleshooting-copy">
        <p>{securitySummary(authMode)}</p>
        <p>Recent raw location evidence is private and normally deleted after seven days.</p>
        <p>If Dayframe looks out of date, refresh this page. If that does not help, log out and sign in again.</p>
        <div className="settings-troubleshooting-actions">
          <SignOutControl className="ui-button ui-button-secondary" />
          <Link className="ui-button ui-button-ghost" href="/review">Open Review</Link>
        </div>
      </div>
    </Disclosure>
  );
}

function permissionCopy(state: PermissionState) {
  switch (state) {
    case "granted":
      return "Allowed in this browser.";
    case "denied":
      return "Blocked in this browser. Change it in your browser’s site settings.";
    case "prompt":
      return "Not decided in this browser.";
  }
}

function securitySummary(authMode: SettingsAuthMode) {
  switch (authMode) {
    case "local":
      return "Email and password are managed by this Dayframe server.";
    case "provider":
      return "Password and sign-in are managed by your secure sign-in provider.";
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
