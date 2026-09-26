// Same-origin requests keep authentication and uploads working on any frontend port.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      return "Invalid input: " + body.detail.map((d: { msg: string }) => d.msg).join("; ");
    }
  } catch {
    // body was not JSON; fall through to the generic message
  }
  return `Backend returned ${response.status}`;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  const headers = authHeaders(init?.headers);
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers, cache: "no-store" });
  } catch (err) {
    if (init?.signal?.aborted) throw err;
    throw new ApiError(`Cannot reach the backend at ${API_URL}. Is it running?`);
  }
  if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("auth-expired", { detail: headers.get("Authorization") }));
  if (typeof window !== "undefined" && headers.get("Authorization") !== authHeaders().get("Authorization")) throw new ApiError("Session changed. Please retry.");
  if (!response.ok) throw new ApiError(await errorMessage(response), response.status);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function authHeaders(initial?: HeadersInit): Headers {
  const headers = new Headers(initial);
  const token = typeof window !== "undefined" ? sessionStorage.getItem("auth_token") : null;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

export async function downloadFile(path: string, filename: string) {
  const headers = authHeaders();
  const response = await fetch(`${API_URL}${path}`, { headers, cache: "no-store" });
  if (response.status === 401) window.dispatchEvent(new CustomEvent("auth-expired", { detail: headers.get("Authorization") }));
  if (!response.ok) throw new ApiError(await errorMessage(response), response.status);
  const blob = await response.blob();
  if (headers.get("Authorization") !== authHeaders().get("Authorization")) throw new ApiError("Session changed. Please retry.");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function withJson(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export const postJson = <T>(path: string, body?: unknown, signal?: AbortSignal) =>
  apiFetch<T>(path, { ...withJson("POST", body), signal });
export const putJson = <T>(path: string, body: unknown) => apiFetch<T>(path, withJson("PUT", body));
export const patchJson = <T>(path: string, body: unknown) => apiFetch<T>(path, withJson("PATCH", body));
export const del = (path: string) => apiFetch<void>(path, { method: "DELETE" });

export type Health = {
  status: string;
  database: string;
  llm: {
    base_url: string;
    model_large: string;
    model_small: string;
    api_key_configured: boolean;
  };
};
