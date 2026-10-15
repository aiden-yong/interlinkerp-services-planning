export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown,
    readonly correlationId: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Envelope = { error?: { code?: string; message?: string; details?: unknown; correlation_id?: string } } | null;

// A 401 means our session or the gateway session ended. Reloading lets proxy.ts
// run the sign-in flow again instead of leaving a broken screen.
let onUnauthorized: () => void = () => window.location.reload();

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export async function api<T>(method: string, path: string, body?: unknown, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetchImpl(path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    if (response.status === 401) onUnauthorized();
    const error = (data as Envelope)?.error;
    throw new ApiError(response.status, error?.code ?? 'UNKNOWN', error?.message ?? `Request failed (${response.status}).`, error?.details ?? null,
      error?.correlation_id ?? response.headers.get('X-Correlation-ID'));
  }
  return data as T;
}

export function query(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) q.set(key, value);
  const s = q.toString();
  return s ? `?${s}` : '';
}
