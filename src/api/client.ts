import {
  ApiError,
  AuthRequiredError,
  NetworkError,
  parseErrorBody,
} from "./errors.js";

export interface ApiClientOptions {
  apiUrl: string;
  token: string | null;
  fetchImpl?: typeof fetch | undefined;
  /** Verbose request/response logger (logs to stderr). */
  onRequest?: ((info: RequestLog) => void) | undefined;
  onResponse?: ((info: ResponseLog) => void) | undefined;
  /** Audit hook (fires once per HTTP call, with parsed path only). */
  onAudit?: ((info: AuditLog) => void) | undefined;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

export interface RequestLog {
  method: string;
  url: string;
  bodyBytes: number;
}

export interface ResponseLog {
  method: string;
  url: string;
  status: number;
  durationMs: number;
}

export interface AuditLog {
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

const NO_CONTENT = 204;

/**
 * REST client for the Seneca API.
 *
 * Wire contract: every successful response is wrapped in `{ data: T }`, every
 * error is `{ error: { code, message, details? } }`. `request<T>` unwraps the
 * envelope and returns `T` directly. `requestRaw` returns the raw envelope
 * for tooling that wants both `data` and pagination metadata when added later.
 */
export class ApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly apiUrl: string;
  private readonly token: string | null;
  private readonly onRequest?: ((info: RequestLog) => void) | undefined;
  private readonly onResponse?: ((info: ResponseLog) => void) | undefined;
  private readonly onAudit?: ((info: AuditLog) => void) | undefined;

  constructor(opts: ApiClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.apiUrl = stripTrailingSlash(opts.apiUrl);
    this.token = opts.token;
    this.onRequest = opts.onRequest;
    this.onResponse = opts.onResponse;
    this.onAudit = opts.onAudit;
  }

  /**
   * Execute a request and return the unwrapped `data` payload. Throws an
   * ApiError, NetworkError, or AuthRequiredError on failure. Returns
   * undefined for 204 No Content responses.
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const wrapped = await this.requestRaw<T>(path, options);
    return wrapped as T;
  }

  /**
   * Execute a request and return the raw response envelope `{ data: T }` or
   * undefined for 204. Most callers want `request<T>` instead.
   */
  async requestRaw<T>(path: string, options: RequestOptions = {}): Promise<T | undefined> {
    if (!this.token) throw new AuthRequiredError();
    const url = this.buildUrl(path, options.query);
    const method = options.method ?? "GET";
    const body = options.body !== undefined ? JSON.stringify(options.body) : undefined;
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body } : {}),
    };

    this.onRequest?.({
      method,
      url,
      bodyBytes: body !== undefined ? body.length : 0,
    });

    const startedAt = performance.now();
    let res: Response;
    try {
      res = await this.fetchImpl(url, init);
    } catch (err) {
      throw new NetworkError(`Failed to reach ${url}`, err);
    }

    const durationMs = Math.round(performance.now() - startedAt);
    this.onResponse?.({ method, url, status: res.status, durationMs });
    this.onAudit?.({
      method,
      path: path.startsWith("/") ? path : `/${path}`,
      status: res.status,
      durationMs,
    });

    return this.parseResponse<T>(res);
  }

  private buildUrl(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(`${this.apiUrl}${path.startsWith("/") ? path : `/${path}`}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async parseResponse<T>(res: Response): Promise<T | undefined> {
    if (res.status === NO_CONTENT) return undefined;

    const text = await res.text();
    const data = text.length > 0 ? safeJsonParse(text) : undefined;

    if (!res.ok) {
      const { code, message, details } = parseErrorBody(res.status, data);
      throw new ApiError(res.status, code, message, details);
    }

    if (data && typeof data === "object" && "data" in data) {
      return (data as { data: T }).data;
    }

    return data as T;
  }
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
