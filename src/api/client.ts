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
 * Wire contract: every successful response is wrapped in
 * `{ data: T, meta?: M }`, every error is `{ error: { code, message, details? } }`.
 *
 * - `request<T>` unwraps `data` and discards `meta` - the common case.
 * - `requestWithMeta<T, M>` returns `{ data, meta }` for callers that need
 *   operation-level metadata (e.g. the saved_as field on page updates).
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
    const envelope = await this.fetchAndParse(path, options);
    if (envelope === undefined) return undefined as T;
    return envelope.data as T;
  }

  /**
   * Execute a request and return the full envelope as `{ data, meta }`. Use
   * this when the route exposes operation metadata (e.g. PATCH /pages/:id
   * returns `meta.saved_as` to tell you whether the write hit live or draft).
   * Returns `{ data: undefined, meta: undefined }` for 204 No Content.
   */
  async requestWithMeta<T, M = Record<string, unknown>>(
    path: string,
    options: RequestOptions = {},
  ): Promise<{ data: T; meta: M | undefined }> {
    const envelope = await this.fetchAndParse(path, options);
    if (envelope === undefined) return { data: undefined as T, meta: undefined };
    return { data: envelope.data as T, meta: envelope.meta as M | undefined };
  }

  private async fetchAndParse(
    path: string,
    options: RequestOptions,
  ): Promise<{ data: unknown; meta: unknown } | undefined> {
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

    return this.parseResponse(res);
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

  private async parseResponse(
    res: Response,
  ): Promise<{ data: unknown; meta: unknown } | undefined> {
    if (res.status === NO_CONTENT) return undefined;

    const text = await res.text();
    const parsed = text.length > 0 ? safeJsonParse(text) : undefined;

    if (!res.ok) {
      const { code, message, details } = parseErrorBody(res.status, parsed);
      throw new ApiError(res.status, code, message, details);
    }

    if (parsed && typeof parsed === "object" && "data" in parsed) {
      const obj = parsed as { data: unknown; meta?: unknown };
      return { data: obj.data, meta: obj.meta };
    }

    // Tolerate non-enveloped success bodies (defensive; production routes
    // always envelope, but legacy or external callers may not).
    return { data: parsed, meta: undefined };
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
