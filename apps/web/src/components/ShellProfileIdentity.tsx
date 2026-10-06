export type ShellIdentity = { userName: string; workspaceName: string };

// The shell renders before the page hands it bootstrap data. Until then it shows
// an empty placeholder, never an invented name or workspace that changes on load.
export function ShellProfileInitials({ identity }: { identity: ShellIdentity | null }) {
  if (!identity) return <span aria-busy="true" className="swiss-profile-placeholder-avatar" />;
  return <span>{initials(identity.userName)}</span>;
}

export function ShellProfileIdentity({ identity }: { identity: ShellIdentity | null }) {
  if (!identity) {
    return (
      <span aria-busy="true" className="swiss-profile-placeholder">
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span className="sr-only">Loading profile</span>
      </span>
    );
  }
  return (
    <span>
      <strong>{identity.userName}</strong>
      <small>{identity.workspaceName}</small>
    </span>
  );
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "D";
  const second = parts[1]?.[0] ?? parts[0]?.[1] ?? "F";
  return `${first}${second}`.toUpperCase();
}
