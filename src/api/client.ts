import { ApiError, AuthRequiredError, NetworkError, type ApiErrorBody } from "./errors.js";

export interface ApiClientOptions {
  apiUrl: string;
  token: string | null;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

export class ApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly apiUrl: string;
  private readonly token: string | null;

  constructor(opts: ApiClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.apiUrl = stripTrailingSlash(opts.apiUrl);
    this.token = opts.token;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (!this.token) throw new AuthRequiredError();
    const url = this.buildUrl(path, options.query);
    const init: RequestInit = {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    };

    let res: Response;
    try {
      res = await this.fetchImpl(url, init);
    } catch (err) {
      throw new NetworkError(`Failed to reach ${url}`, err);
    }

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

  private async parseResponse<T>(res: Response): Promise<T> {
    const text = await res.text();
    const data = text.length > 0 ? safeJsonParse(text) : undefined;
    if (!res.ok) {
      const body = (data ?? {}) as ApiErrorBody;
      const code = typeof body.error === "string" ? body.error : `http_${res.status}`;
      const message = typeof body.message === "string" ? body.message : res.statusText;
      throw new ApiError(res.status, code, message, body.details);
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
