/**
 * The API's `{ error: { code, message, requestId, details? } }` envelope, as
 * an exception. Shared by `api.ts` and `auth/session.ts` (both call the
 * external API directly now — see session.ts for why there is no longer a
 * local proxy layer) so every screen can render one `ErrorState` component
 * regardless of which of the two a given action happened to call.
 */

export interface ApiErrorDetail {
  field?: string;
  message?: string;
  code?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: ApiErrorDetail[] | Record<string, unknown> | null;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId: string | null,
    details: ApiErrorDetail[] | Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }

  /** Field-level validation messages, when the failure was a `VALIDATION_ERROR`. */
  get fieldErrors(): ApiErrorDetail[] {
    return Array.isArray(this.details) ? this.details : [];
  }
}

export function networkError(baseUrl: string): ApiError {
  return new ApiError(
    0,
    'NETWORK_UNREACHABLE',
    `Could not reach the API at ${baseUrl}. Check that it is running.`,
    null,
  );
}

/** Turns a non-ok `Response` into an `ApiError`, reading the envelope if there is one. */
export async function parseErrorResponse(response: Response): Promise<ApiError> {
  const requestId = response.headers.get('X-Request-Id');

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON error body means something in front of the API answered
    // (a proxy, a platform error page) rather than the API itself.
  }

  const envelope = (body as { error?: Record<string, unknown> } | null)?.error;

  if (envelope && typeof envelope.code === 'string') {
    return new ApiError(
      response.status,
      envelope.code,
      typeof envelope.message === 'string' ? envelope.message : response.statusText,
      typeof envelope.requestId === 'string' ? envelope.requestId : requestId,
      (envelope.details as ApiErrorDetail[] | Record<string, unknown> | undefined) ?? null,
    );
  }

  return new ApiError(
    response.status,
    'UNEXPECTED_RESPONSE',
    `The server answered ${response.status} without an error envelope.`,
    requestId,
  );
}
