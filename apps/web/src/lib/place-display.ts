import { PLACE_ROLES, placeRoleLabel } from "@dayframe/shared";

function checkedAlias(alias: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error(`Invalid places alias: ${alias}`);
  return alias;
}

/** SQL for a saved place's role label ("Home", "Work"), or null when it holds no role. */
export function placeRoleLabelSql(alias: string) {
  const table = checkedAlias(alias);
  const cases = PLACE_ROLES.map((role) => `when '${role}' then '${placeRoleLabel(role)}'`).join(" ");
  return `(case ${table}.role ${cases} end)`;
}

/**
 * SQL for what the interface calls a saved place: its role label when it holds a role,
 * otherwise its saved name. `alias` is the places table alias in the query. Every read
 * path that shows a saved place's name uses this, so a Home saved under its street
 * address reads "Home" in entries, Review, Reports, search and exports.
 */
export function placeDisplayNameSql(alias: string) {
  return `coalesce(${placeRoleLabelSql(alias)}, ${checkedAlias(alias)}.name)`;
}
