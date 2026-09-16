/** The application's JSON envelope, with HTTP and network failures normalized. */
export type ApiResult<T> =
  | { data: T; error: null }
  | { data: null; error: string; code?: string; details?: unknown };

/** For endpoints whose status or extra envelope fields carry a product decision. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<{
  ok: boolean; status: number; body: T | null;
} | null> {
  try {
    const response = await (init && Object.keys(init).length ? fetch(url, init) : fetch(url));
    const body = await response.json().catch(() => null) as T | null;
    return { ok: response.ok, status: response.status, body };
  } catch {
    return null;
  }
}

export async function requestJson<T>(
  url: string,
  {
    errorMessage,
    validateData,
    ...init
  }: RequestInit & {
    errorMessage: string | ((status?: number) => string);
    validateData?: (value: unknown) => value is T;
  },
): Promise<ApiResult<T>> {
  const fallback = (status?: number) =>
    typeof errorMessage === "string" ? errorMessage : errorMessage(status);
  try {
    const response = await fetchJson<{ data?: unknown; error?: unknown; code?: unknown; details?: unknown }>(url, init);
    if (!response) return { data: null, error: fallback() };
    const body = response.body;
    const error = typeof body?.error === "string" && body.error ? body.error : null;
    if (!response.ok || error || body?.data === undefined || (validateData ? !validateData(body.data) : body.data === null)) {
      return { data: null, error: error ?? fallback(response.ok ? undefined : response.status),
        ...(typeof body?.code === "string" ? { code: body.code } : {}),
        ...(body?.details !== undefined ? { details: body.details } : {}),
      };
    }
    return { data: body.data as T, error: null };
  } catch {
    return { data: null, error: fallback() };
  }
}
