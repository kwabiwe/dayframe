type ClientAuthEnvironment = {
  pathname: string;
  redirect: (href: string) => void;
};

const LOGIN_REDIRECT_CODES = new Set([
  "session_cookie_missing",
  "session_invalid",
  "session_expired",
  "session_revoked"
]);

let loginRedirectStarted = false;

export async function clientFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  await handleClientAuthResponse(response);
  return response;
}

export async function handleClientAuthResponse(
  response: Pick<Response, "status" | "clone">,
  environment: ClientAuthEnvironment | null = browserAuthEnvironment()
) {
  if (response.status !== 401) return false;
  const code = await publicAuthErrorCode(response);
  if (!code || !LOGIN_REDIRECT_CODES.has(code)) return false;
  if (!environment || environment.pathname === "/login" || environment.pathname === "/signup") {
    return true;
  }

  if (!loginRedirectStarted) {
    loginRedirectStarted = true;
    environment.redirect("/login");
  }
  return true;
}

export function resetClientAuthRedirectStateForTests() {
  loginRedirectStarted = false;
}

function browserAuthEnvironment(): ClientAuthEnvironment | null {
  if (typeof window === "undefined") return null;
  return {
    pathname: window.location.pathname,
    redirect: (href) => window.location.replace(href)
  };
}

async function publicAuthErrorCode(response: Pick<Response, "clone">) {
  try {
    const payload = (await response.clone().json()) as { code?: unknown };
    return typeof payload.code === "string" ? payload.code : null;
  } catch {
    return null;
  }
}
