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
    super("Not authenticated. Run `sncb auth login` first or pass --token.");
    this.name = "AuthRequiredError";
  }
}

export interface ApiErrorBody {
  error?: string;
  message?: string;
  details?: unknown;
}

export function exitCodeForError(err: unknown): number {
  if (err instanceof AuthRequiredError) return 4;
  if (err instanceof ApiError) {
    if (err.status >= 500) return 2;
    return 1;
  }
  if (err instanceof NetworkError) return 3;
  return 1;
}
