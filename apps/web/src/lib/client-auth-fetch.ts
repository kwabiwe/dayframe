type ClientAuthEnvironment = {
  pathname: string;
  redirect: (href: string) => void;
};

let loginRedirectStarted = false;

export async function clientFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  handleClientAuthResponse(response);
  return response;
}

export function handleClientAuthResponse(
  response: Pick<Response, "status">,
  environment: ClientAuthEnvironment | null = browserAuthEnvironment()
) {
  if (response.status !== 401) return false;
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
