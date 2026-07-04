import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type pg from "pg";
import { z } from "zod";
import { normalizePaletteKey } from "@dayframe/shared";
import { hasTableColumn, pool, query } from "@/lib/db";
import { AuthError, type RequestSession } from "@/lib/session";

export const APP_SESSION_COOKIE = "dayframe_session";
export const APP_SESSION_TTL_SECONDS = Number(process.env.DAYFRAME_SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 30);

export const SignupInputSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(120).optional(),
  workspaceName: z.string().trim().min(1).max(120).optional()
});

export const LoginInputSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200)
});

export type AuthPayload = {
  token: string;
  user: { id: string; email: string; name: string };
  workspace: { id: string; name: string };
  expiresAt: string;
};

export type UserRow = {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
};

export type WorkspaceRow = {
  id: string;
  name: string;
};

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function generateSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: APP_SESSION_TTL_SECONDS
  };
}

export function sessionTokenFromRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const cookie of cookieHeader.split(";")) {
    const [name, ...rest] = cookie.trim().split("=");
    if (name === APP_SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }

  return null;
}

export function expiredSessionCookieOptions() {
  return {
    ...sessionCookieOptions(),
    maxAge: 0
  };
}

export async function signupLocalAccount(input: z.input<typeof SignupInputSchema>, userAgent?: string | null) {
  const parsed = SignupInputSchema.parse(input);
  const email = normalizeEmail(parsed.email);
  const displayName = parsed.name?.trim() || email.split("@")[0] || "Dayframe user";
  const workspaceName = parsed.workspaceName?.trim() || "My Dayframe";
  const passwordHash = await hashPassword(parsed.password);
  const client = await pool.connect();

  try {
    await client.query("begin");
    const existing = await client.query("select id from users where email = $1", [email]);
    if (existing.rowCount) {
      throw new AuthError("An account already exists for this email.", 409);
    }

    const user = await client.query<UserRow>(
      `insert into users (email, name, password_hash)
       values ($1, $2, $3)
       returning id, email, name, password_hash as "passwordHash"`,
      [email, displayName, passwordHash]
    );
    const workspace = await client.query<WorkspaceRow>(
      `insert into workspaces (name)
       values ($1)
       returning id, name`,
      [workspaceName]
    );

    await client.query(
      "insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')",
      [workspace.rows[0].id, user.rows[0].id]
    );
    await seedDefaultWorkspaceData(client, workspace.rows[0].id);
    const auth = await createSession(client, user.rows[0].id, workspace.rows[0].id, userAgent);

    await client.query("commit");
    return toAuthPayload(auth.token, auth.expiresAt, user.rows[0], workspace.rows[0]);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function loginLocalAccount(input: z.input<typeof LoginInputSchema>, userAgent?: string | null) {
  const parsed = LoginInputSchema.parse(input);
  const email = normalizeEmail(parsed.email);
  const user = await query<UserRow>(
    `select id, email, name, password_hash as "passwordHash"
     from users
     where email = $1`,
    [email]
  );
  const userRow = user.rows[0];
  if (!userRow?.passwordHash || !(await verifyPassword(parsed.password, userRow.passwordHash))) {
    throw new AuthError("Invalid email or password.");
  }

  const workspace = await getDefaultWorkspaceForUser(userRow.id);
  if (!workspace) throw new AuthError("No workspace membership exists for this account.");

  const client = await pool.connect();
  try {
    const auth = await createSession(client, userRow.id, workspace.id, userAgent);
    return toAuthPayload(auth.token, auth.expiresAt, userRow, workspace);
  } finally {
    client.release();
  }
}

export async function resolveLocalSession(
  token: string | null | undefined,
  authMode: "local" | "provider" = "local"
): Promise<RequestSession> {
  if (!token) throw new AuthError("Login required.");
  const tokenHash = hashSessionToken(token);
  const session = await query<{ userId: string; workspaceId: string }>(
    `update auth_sessions
     set last_used_at = now()
     where token_hash = $1 and revoked_at is null and expires_at > now()
     returning user_id as "userId", workspace_id as "workspaceId"`,
    [tokenHash]
  );
  const row = session.rows[0];
  if (!row) throw new AuthError("Login required.");

  return {
    userId: row.userId,
    workspaceId: row.workspaceId,
    authMode,
    scopes: ["app:read", "app:write", "events:write", "exports:read"]
  };
}

export async function revokeLocalSession(token: string | null | undefined) {
  if (!token) return;
  await query("update auth_sessions set revoked_at = now() where token_hash = $1", [
    hashSessionToken(token)
  ]);
}

export async function switchLocalSessionWorkspace(token: string | null | undefined, workspaceId: string) {
  if (!token) throw new AuthError("Login required.");
  const tokenHash = hashSessionToken(token);
  const result = await query<{ workspaceId: string }>(
    `with current_session as (
       select user_id
       from auth_sessions
       where token_hash = $1 and revoked_at is null and expires_at > now()
     ),
     allowed_workspace as (
       select wm.workspace_id
       from workspace_members wm
       join current_session cs on cs.user_id = wm.user_id
       where wm.workspace_id = $2
     )
     update auth_sessions
     set workspace_id = (select workspace_id from allowed_workspace),
         last_used_at = now()
     where token_hash = $1
       and exists (select 1 from allowed_workspace)
     returning workspace_id as "workspaceId"`,
    [tokenHash, workspaceId]
  );

  if (!result.rows[0]) throw new AuthError("Workspace is not available for this account.", 403);
  return result.rows[0];
}

export async function createSession(
  client: pg.PoolClient,
  userId: string,
  workspaceId: string,
  userAgent?: string | null
) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + APP_SESSION_TTL_SECONDS * 1000);
  await client.query(
    `insert into auth_sessions (user_id, workspace_id, token_hash, expires_at, user_agent, last_used_at)
     values ($1, $2, $3, $4, $5, now())`,
    [userId, workspaceId, hashSessionToken(token), expiresAt, userAgent ?? null]
  );

  return { token, expiresAt };
}

export async function getDefaultWorkspaceForUser(userId: string) {
  const workspace = await query<WorkspaceRow>(
    `select w.id, w.name
     from workspaces w
     join workspace_members wm on wm.workspace_id = w.id
     where wm.user_id = $1
     order by case wm.role when 'owner' then 0 else 1 end, wm.created_at
     limit 1`,
    [userId]
  );
  return workspace.rows[0] ?? null;
}

export async function seedDefaultWorkspaceData(client: pg.PoolClient, workspaceId: string) {
  const clientRow = await client.query<{ id: string }>(
    `insert into clients (workspace_id, name, color)
     values ($1, 'Personal', $2)
     returning id`,
    [workspaceId, normalizePaletteKey("steel", "Personal")]
  );
  const supportsPinnedCategories = await hasTableColumn(client, "categories", "is_pinned");
  const categoryRow = supportsPinnedCategories
    ? await client.query<{ id: string }>(
        `insert into categories (workspace_id, name, color, is_pinned)
         values ($1, 'General', $2, true)
         returning id`,
        [workspaceId, normalizePaletteKey("lime", "General")]
      )
    : await client.query<{ id: string }>(
        `insert into categories (workspace_id, name, color)
         values ($1, 'General', $2)
         returning id`,
        [workspaceId, normalizePaletteKey("lime", "General")]
      );
  await client.query(
    `insert into projects (workspace_id, client_id, category_id, name, color, billable)
     values ($1, $2, $3, 'General', $4, false)`,
    [workspaceId, clientRow.rows[0].id, categoryRow.rows[0].id, normalizePaletteKey("lime", "General")]
  );
  await client.query(
    `insert into event_sources (workspace_id, source, display_name)
     values
       ($1, 'manual_app', 'Manual web app'),
       ($1, 'mobile_app', 'Mobile app'),
       ($1, 'shortcut', 'Shortcut or deep link'),
       ($1, 'geofence_specific', 'Specific geofence'),
       ($1, 'geofence_broad', 'Broad geofence'),
       ($1, 'health_sleep', 'Health sleep import'),
       ($1, 'health_workout', 'Health workout import')
     on conflict (workspace_id, source) do nothing`,
    [workspaceId]
  );
}

export function toAuthPayload(
  token: string,
  expiresAt: Date,
  user: UserRow,
  workspace: WorkspaceRow
): AuthPayload {
  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name
    },
    workspace,
    expiresAt: expiresAt.toISOString()
  };
}
