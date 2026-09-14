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

export async function apiRequest<TData>(
  path: string,
  options: RequestOptions = {},
): Promise<TData> {
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
    return undefined as TData;
  }

  const payload = (await response.json().catch(() => null)) as {
    data?: TData;
    error?: { code: string; details?: ApiErrorDetail[] };
  } | null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'internal_error',
      payload?.error?.details,
    );
  }

  return payload?.data as TData;
}
