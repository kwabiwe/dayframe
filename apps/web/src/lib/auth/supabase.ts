import type pg from "pg";
import { createClient } from "@supabase/supabase-js";
import {
  LoginInputSchema,
  SignupInputSchema,
  createSession,
  normalizeEmail,
  seedDefaultWorkspaceData,
  toAuthPayload,
  type AuthPayload,
  type UserRow,
  type WorkspaceRow
} from "@/lib/auth/local";
import { pool } from "@/lib/db";
import { AuthError } from "@/lib/session";

type ProviderSignupPendingPayload = {
  requiresEmailConfirmation: true;
  message: string;
  user: { id: string; email: string; name: string };
  workspace: { id: string; name: string };
};

export type ProviderAuthPayload = AuthPayload | ProviderSignupPendingPayload;

type SupabaseUserIdentity = {
  id: string;
  email: string;
  name: string;
  workspaceName: string;
};

export async function signupSupabaseAccount(
  input: unknown,
  userAgent?: string | null
): Promise<ProviderAuthPayload> {
  const parsed = SignupInputSchema.parse(input);
  const email = normalizeEmail(parsed.email);
  assertProviderSignupAllowed(email);

  const name = parsed.name?.trim() || email.split("@")[0] || "Dayframe user";
  const workspaceName = parsed.workspaceName?.trim() || "My Dayframe";
  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password: parsed.password,
    options: { data: { name, workspace_name: workspaceName } }
  });

  if (error) throw new AuthError(error.message, authStatus(error.status));
  if (!data.user?.id) throw new AuthError("Supabase did not return a user.", 502);

  const account = await ensureDayframeAccountForProviderUser({
    id: data.user.id,
    email: data.user.email ?? email,
    name,
    workspaceName
  });

  if (!data.session) {
    return {
      requiresEmailConfirmation: true,
      message: "Check your email to confirm your Supabase account, then log in to Dayframe.",
      user: toPublicUser(account.user),
      workspace: account.workspace
    };
  }

  return createProviderAppSession(account.user, account.workspace, userAgent);
}

export async function loginSupabaseAccount(input: unknown, userAgent?: string | null): Promise<AuthPayload> {
  const parsed = LoginInputSchema.parse(input);
  const email = normalizeEmail(parsed.email);
  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.password
  });

  if (error) throw new AuthError(error.message, authStatus(error.status));
  if (!data.user?.id) throw new AuthError("Supabase did not return a user.", 502);

  const metadata = data.user.user_metadata ?? {};
  const account = await ensureDayframeAccountForProviderUser({
    id: data.user.id,
    email: data.user.email ?? email,
    name: stringMetadata(metadata.name) ?? email.split("@")[0] ?? "Dayframe user",
    workspaceName: stringMetadata(metadata.workspace_name) ?? "My Dayframe"
  });

  return createProviderAppSession(account.user, account.workspace, userAgent);
}

export function getSupabaseProviderEnvStatus() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return {
    hasUrl: Boolean(url),
    hasAnonKey: Boolean(anonKey),
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    signupsEnabled: providerSignupsEnabled(),
    allowedEmailCount: allowedSignupEmails().size
  };
}

async function createProviderAppSession(
  user: UserRow,
  workspace: WorkspaceRow,
  userAgent?: string | null
) {
  const client = await pool.connect();
  try {
    const session = await createSession(client, user.id, workspace.id, userAgent);
    return toAuthPayload(session.token, session.expiresAt, user, workspace);
  } finally {
    client.release();
  }
}

async function ensureDayframeAccountForProviderUser(identity: SupabaseUserIdentity) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const conflictingUser = await client.query<{ id: string }>(
      "select id from users where email = $1 and id <> $2 limit 1",
      [identity.email, identity.id]
    );

    if (conflictingUser.rows[0]) {
      throw new AuthError(
        "A Dayframe user already exists for this email with a different identity. Migrate that account before using Supabase Auth.",
        409
      );
    }

    const user = await client.query<UserRow>(
      `insert into users (id, email, name, password_hash)
       values ($1, $2, $3, null)
       on conflict (id) do update
       set email = excluded.email,
           name = excluded.name
       returning id, email, name, password_hash as "passwordHash"`,
      [identity.id, identity.email, identity.name]
    );

    let workspace = await getDefaultWorkspaceForUserInTransaction(client, identity.id);
    if (!workspace) {
      workspace = (
        await client.query<WorkspaceRow>(
          `insert into workspaces (name)
           values ($1)
           returning id, name`,
          [identity.workspaceName]
        )
      ).rows[0];

      await client.query(
        "insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')",
        [workspace.id, identity.id]
      );
      await seedDefaultWorkspaceData(client, workspace.id);
    }

    await client.query("commit");
    return { user: user.rows[0], workspace };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function getDefaultWorkspaceForUserInTransaction(client: pg.PoolClient, userId: string) {
  const workspace = await client.query<WorkspaceRow>(
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

function createSupabaseAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new AuthError(
      "Supabase Auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      500
    );
  }

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
}

function assertProviderSignupAllowed(email: string) {
  const allowed = allowedSignupEmails();
  if (allowed.has(email)) return;
  if (providerSignupsEnabled()) return;

  throw new AuthError(
    "Signups are restricted for this Dayframe deployment. Ask the owner to add this email to DAYFRAME_ALLOWED_SIGNUP_EMAILS.",
    403
  );
}

function providerSignupsEnabled() {
  if (process.env.DAYFRAME_SIGNUPS_ENABLED === "true") return true;
  if (process.env.DAYFRAME_SIGNUPS_ENABLED === "false") return false;
  return process.env.NODE_ENV !== "production";
}

function allowedSignupEmails() {
  return new Set(
    (process.env.DAYFRAME_ALLOWED_SIGNUP_EMAILS ?? "")
      .split(",")
      .map((email) => normalizeEmail(email))
      .filter(Boolean)
  );
}

function authStatus(status: number | undefined) {
  if (!status) return 401;
  if (status >= 500) return 502;
  return status;
}

function stringMetadata(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toPublicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    name: user.name
  };
}
