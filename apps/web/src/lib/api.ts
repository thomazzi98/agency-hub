import { strings } from './strings';

export interface ApiErrorDetail {
  field: string;
  issue: string;
}

/**
 * Carries the backend's stable English `code`; components branch on that and read
 * their pt-BR copy from the strings layer rather than showing a backend message.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: ApiErrorDetail[],
  ) {
    super(strings.errors[code] ?? strings.app.genericError);
    this.name = 'ApiError';
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /**
   * The session behind the cookie is gone — expired, revoked from another device, or
   * its account deactivated. A wrong password at sign-in is also a 401 and is not this.
   */
  get isSessionLost(): boolean {
    return (
      this.status === 401 && (this.code === 'unauthenticated' || this.code === 'account_inactive')
    );
  }

  get requiresPasswordChange(): boolean {
    return this.code === 'password_change_required';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

const API_BASE = '/api';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface Envelope<TData> {
  data: TData;
  /** Present only on paginated list endpoints (15-api-conventions.md). */
  meta?: PageMeta;
}

export async function apiEnvelope<TData>(
  path: string,
  options: RequestOptions = {},
): Promise<Envelope<TData>> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      // The session lives in an httpOnly cookie; it is never readable by this code.
      credentials: 'same-origin',
      headers: options.body === undefined ? {} : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError(0, 'network_error');
  }

  if (response.status === 204) {
    return { data: undefined as TData };
  }

  const payload = (await response.json().catch(() => null)) as {
    data?: TData;
    meta?: PageMeta;
    error?: { code: string; details?: ApiErrorDetail[] };
  } | null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'internal_error',
      payload?.error?.details,
    );
  }

  // A 2xx that is not the API's envelope - a proxy's HTML page, a server restarting
  // behind the dev proxy - is a failure to report, not `undefined` to hand a screen
  // that expects rows.
  if (!payload || !('data' in payload)) {
    throw new ApiError(response.status, 'internal_error');
  }

  return { data: payload.data as TData, meta: payload.meta };
}

export async function apiRequest<TData>(
  path: string,
  options: RequestOptions = {},
): Promise<TData> {
  return (await apiEnvelope<TData>(path, options)).data;
}

export function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}
