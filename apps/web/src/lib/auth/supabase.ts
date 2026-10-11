import type pg from "pg";
import { createClient, isAuthRetryableFetchError, type User as SupabaseUser } from "@supabase/supabase-js";
import {
  LoginInputSchema,
  SignupInputSchema,
  createSessionInTransaction,
  databaseNow,
  endSignInsAfterPasswordChange,
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
  // Taken before the account's password is set: a reset since then refuses this sign-in too.
  const authenticatedAt = await databaseNow();
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

  return createProviderAppSession(account.user, account.workspace, userAgent, authenticatedAt);
}

export async function loginSupabaseAccount(input: unknown, userAgent?: string | null): Promise<AuthPayload> {
  const parsed = LoginInputSchema.parse(input);
  const email = normalizeEmail(parsed.email);
  const supabase = createSupabaseAuthClient();
  // Taken before the password check: a reset since then refuses this sign-in (createSession).
  const authenticatedAt = await databaseNow();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.password
  });

  if (error) throw new AuthError(error.message, authStatus(error.status));
  if (!data.user?.id) throw new AuthError("Supabase did not return a user.", 502);

  const account = await ensureDayframeAccountForProviderUser(providerIdentity(data.user, email));

  return createProviderAppSession(account.user, account.workspace, userAgent, authenticatedAt);
}

export async function changeSupabasePassword(
  email: string,
  currentPassword: string,
  newPassword: string
) {
  const supabase = createSupabaseAuthClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: normalizeEmail(email),
    password: currentPassword
  });
  if (signInError) throw new AuthError("Current password is incorrect.", 400);

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) throw new AuthError(updateError.message, authStatus(updateError.status));
}

/**
 * Forgot password (UIA-317): Supabase emails a recovery link that returns to Dayframe's
 * /reset-password page. The caller always answers the same way whether or not an account uses the
 * address, so the reply never reveals who has an account.
 */
export async function requestSupabasePasswordReset(email: string, redirectTo: string) {
  const supabase = createSupabaseAuthClient();
  const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), { redirectTo });
  if (error) throw new AuthError(error.status === 429 ? "Too many reset emails. Wait a minute, then try again." : "Dayframe couldn't send the reset email. Try again later.", error.status === 429 ? 429 : 502);
}

/**
 * Sets the new password from a recovery link's session, then ends every Dayframe sign-in for that
 * account (web and iPhone), since a reset is often about a password someone else may know.
 */
export async function completeSupabasePasswordReset(input: { accessToken: string; refreshToken: string; password: string }) {
  const supabase = createSupabaseAuthClient();
  const { data, error: sessionError } = await supabase.auth.setSession({
    access_token: input.accessToken,
    refresh_token: input.refreshToken
  });
  if (sessionError && (isAuthRetryableFetchError(sessionError) || (sessionError.status ?? 0) >= 500)) {
    // The sign-in service didn't answer: nothing has changed and the same link can be tried again.
    throw new AuthError("Dayframe couldn't reach the sign-in service. Try again in a moment.", 503);
  }
  if (sessionError || !data.user?.id) {
    throw new AuthError("This reset link has expired or was already used. Ask for a new one.", 400);
  }
  const userId = data.user.id;
  // The account needs its Dayframe row before the password changes, so the reset's fence has
  // somewhere to live (a first sign-in would create the same row).
  await ensureDayframeAccountForProviderUser(providerIdentity(data.user, data.user.email ?? ""));
  // Dayframe sign-ins end before the password changes: if this fails, nothing has changed and the
  // same link can be used again.
  await endSignInsAfterPasswordChange(userId);
  const { error: updateError } = await supabase.auth.updateUser({ password: input.password });
  // A retry after a later step failed: the password is already this one; carry on.
  if (updateError && (updateError as { code?: string }).code !== "same_password") {
    throw new AuthError(updateError.message, authStatus(updateError.status));
  }
  // Again after the change: no sign-in that checked the old password can start a session now
  // (createSession refuses one authenticated before this), and any made meanwhile are revoked.
  await endSignInsAfterPasswordChange(userId);
  // The recovery session itself must end too, or its tokens could change the password again. A
  // failure is reported so the page can try again with the same link (each step above repeats safely).
  const { error: signOutError } = await supabase.auth.signOut({ scope: "global" })
    .catch(() => ({ error: new Error("sign-out failed") }));
  if (signOutError) {
    throw new AuthError("Your password is changed, but signing you out everywhere didn't finish. Try again.", 502);
  }
}

/** The Dayframe identity for a Supabase user, as a sign-in provisions it. */
function providerIdentity(user: SupabaseUser, fallbackEmail: string): SupabaseUserIdentity {
  const metadata = user.user_metadata ?? {};
  const email = user.email ?? fallbackEmail;
  return {
    id: user.id,
    email,
    name: stringMetadata(metadata.name) ?? email.split("@")[0] ?? "Dayframe user",
    workspaceName: stringMetadata(metadata.workspace_name) ?? "My Dayframe"
  };
}

export function getSupabaseProviderEnvStatus() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const publicKey = getSupabasePublicApiKey();
  return {
    hasUrl: Boolean(url),
    hasAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    hasPublishableKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    hasPublicKey: Boolean(publicKey),
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    signupsEnabled: providerSignupsEnabled(),
    allowedEmailCount: allowedSignupEmails().size
  };
}

async function createProviderAppSession(
  user: UserRow,
  workspace: WorkspaceRow,
  userAgent: string | null | undefined,
  authenticatedAt: Date
) {
  const session = await createSessionInTransaction(user.id, workspace.id, userAgent, authenticatedAt);
  return toAuthPayload(session.token, session.expiresAt, user, workspace);
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
  const publicKey = getSupabasePublicApiKey();

  if (!url || !publicKey) {
    throw new AuthError(
      "Supabase Auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      500
    );
  }

  return createClient(url, publicKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
}

function getSupabasePublicApiKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
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
