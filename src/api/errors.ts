/**
 * sncb-side mirrors of the API error contract.
 *
 * The Seneca API guarantees one of these wire formats for every error:
 *
 *   { "error": { "code": "page_not_found", "message": "Page abc not found",
 *                "details": { "field": "slug" } } }
 *
 * We parse it into ApiError so commands can react to the machine-readable
 * `code` rather than fragile substring matching on the human message.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class NetworkError extends Error {
  constructor(message: string, public readonly cause: unknown) {
    super(message);
    this.name = "NetworkError";
  }
}

export class AuthRequiredError extends Error {
  constructor() {
    super("Not authenticated. Run `sncb auth login` first, or pass --token.");
    this.name = "AuthRequiredError";
  }
}

export interface StructuredErrorBody {
  error?:
    | string
    | {
        code?: string;
        message?: string;
        details?: unknown;
      };
  message?: string;
}

/**
 * Extract code/message/details from any wire shape the API may produce, with
 * sensible fallbacks for legacy / unexpected payloads.
 */
export function parseErrorBody(
  status: number,
  body: unknown,
): { code: string; message: string; details?: unknown } {
  const fallback = {
    code: `http_${status}`,
    message: defaultMessageForStatus(status),
  };
  if (!body || typeof body !== "object") return fallback;
  const b = body as StructuredErrorBody;
  if (b.error && typeof b.error === "object") {
    return {
      code: typeof b.error.code === "string" ? b.error.code : fallback.code,
      message:
        typeof b.error.message === "string" ? b.error.message : fallback.message,
      details: b.error.details,
    };
  }
  if (typeof b.error === "string") {
    return { code: b.error, message: b.error };
  }
  if (typeof b.message === "string") {
    return { code: fallback.code, message: b.message };
  }
  return fallback;
}

function defaultMessageForStatus(status: number): string {
  if (status === 401) return "Authentication required";
  if (status === 403) return "Forbidden";
  if (status === 404) return "Not found";
  if (status === 409) return "Conflict";
  if (status === 429) return "Rate limited";
  if (status >= 500) return "Internal server error";
  return `HTTP ${status}`;
}

export function exitCodeForError(err: unknown): number {
  if (err instanceof AuthRequiredError) return 4;
  if (err instanceof ApiError) {
    if (err.status >= 500) return 2;
    if (err.status === 401) return 4;
    return 1;
  }
  if (err instanceof NetworkError) return 3;
  return 1;
}
