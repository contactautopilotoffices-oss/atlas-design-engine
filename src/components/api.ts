"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public issues?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

/** Small fetch wrapper for our own API. Throws ApiError with a human-readable message. */
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.code, data.issues);
  return data as T;
}

/** Confirms and deletes a resource, offering a second confirmation if the server returns 409 force-deletable conflict. */
export async function deleteResource(url: string, confirmText: string): Promise<boolean> {
  if (!confirm(confirmText)) return false;
  try {
    await api(url, { method: "DELETE" });
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && (e.code === "reference_in_use" || e.code === "property_in_use")) {
      if (!confirm(`${e.message}\n\nDelete anyway?`)) return false;
      const sep = url.includes("?") ? "&" : "?";
      await api(`${url}${sep}force=true`, { method: "DELETE" });
      return true;
    }
    throw e;
  }
}
