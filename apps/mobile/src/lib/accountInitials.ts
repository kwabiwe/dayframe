/** Up to two initials from the account name, else the email's first letter. */
export function accountInitials(name: string | null | undefined, email: string | null | undefined) {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length) return words.slice(0, 2).map((word) => Array.from(word)[0]!.toUpperCase()).join("");
  const first = Array.from((email ?? "").trim())[0];
  return first ? first.toUpperCase() : "";
}
