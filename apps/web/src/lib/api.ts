const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type JwtPayload = {
  exp?: number;
};

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in?: number;
  user?: {
    id: number;
    email: string;
    is_admin: boolean;
  };
};

let accessToken: string | null = null;
let refreshPromise: Promise<string> | null = null;

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    if (typeof window !== "undefined") {
      return window.atob(padded);
    }
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
};

const apiUrl = (path: string) => (path.startsWith("http") ? path : `${baseUrl}${path}`);

const isAuthPath = (path: string) => {
  const resolved = path.startsWith("http") ? new URL(path).pathname : path;
  return resolved.startsWith("/auth/") || resolved.startsWith("/setup");
};

export const getTokenPayload = (token: string): JwtPayload | null => {
  const [, payload] = token.split(".");
  if (!payload) return null;
  const decoded = decodeBase64Url(payload);
  if (!decoded) return null;
  try {
    return JSON.parse(decoded) as JwtPayload;
  } catch {
    return null;
  }
};

export const getToken = () => accessToken;

export const hasValidToken = () => {
  if (!accessToken) return false;
  const payload = getTokenPayload(accessToken);
  if (!payload?.exp) return false;
  return payload.exp * 1000 > Date.now() + 5000;
};

export const setToken = (token: string | null) => {
  accessToken = token;
};

export const clearToken = () => {
  accessToken = null;
};

const parseError = async (response: Response) => {
  const message = await response.text();
  try {
    const parsed = JSON.parse(message) as { detail?: string };
    return parsed.detail || message;
  } catch {
    return message;
  }
};

const refreshAccessToken = async () => {
  const response = await fetch(apiUrl("/auth/refresh"), {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    clearToken();
    throw new Error("Session expired. Sign in again.");
  }
  const data = (await response.json()) as TokenResponse;
  setToken(data.access_token);
  return data.access_token;
};

const getFreshAccessToken = () => {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
};

export const ensureAccessToken = async () => {
  if (hasValidToken()) return accessToken;
  try {
    return await getFreshAccessToken();
  } catch {
    return null;
  }
};

const fetchWithAuth = async (path: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers || {});
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(apiUrl(path), {
    ...options,
    headers,
    credentials: "include",
  });
};

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response = await fetchWithAuth(path, options);
  if (response.status === 401 && !isAuthPath(path)) {
    try {
      await getFreshAccessToken();
      response = await fetchWithAuth(path, options);
    } catch {
      clearToken();
      throw new Error("Authentication expired. Sign in again.");
    }
  }

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      throw new Error("Authentication expired. Sign in again.");
    }
    throw new Error((await parseError(response)) || "Request failed");
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export const authApi = {
  setupStatus: () => apiFetch<{ setup_required: boolean }>("/setup/status"),
  setup: (email: string, password: string) =>
    apiFetch<TokenResponse>("/setup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  signup: (email: string, password: string) =>
    apiFetch<TokenResponse>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string) =>
    apiFetch<TokenResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => apiFetch<{ id: number; email: string; is_admin: boolean }>("/auth/me"),
  refresh: () => apiFetch<TokenResponse>("/auth/refresh", { method: "POST" }),
  logout: () => apiFetch("/auth/logout", { method: "POST" }),
};
