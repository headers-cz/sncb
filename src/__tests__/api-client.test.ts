import { describe, it, expect, mock } from "bun:test";
import { ApiClient } from "../api/client.js";
import { ApiError, AuthRequiredError, NetworkError } from "../api/errors.js";

function mockResponse(body: unknown, init: { status?: number } = {}): Response {
  const status = init.status ?? 200;
  const text = body === undefined ? "" : JSON.stringify(body);
  return new Response(text, { status });
}

describe("ApiClient", () => {
  it("throws AuthRequiredError when no token", async () => {
    const client = new ApiClient({ apiUrl: "https://x", token: null });
    await expect(client.request("/api/v1/foo")).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it("issues GET with Authorization header", async () => {
    const fetchImpl = mock(() => Promise.resolve(mockResponse({ id: "1" })));
    const client = new ApiClient({
      apiUrl: "https://x",
      token: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const data = await client.request<{ id: string }>("/api/v1/foo");
    expect(data).toEqual({ id: "1" });
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://x/api/v1/foo");
    expect(call[1].method).toBe("GET");
    expect((call[1].headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
  });

  it("strips trailing slash from apiUrl", async () => {
    const fetchImpl = mock(() => Promise.resolve(mockResponse({})));
    const client = new ApiClient({
      apiUrl: "https://x/",
      token: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.request("/foo");
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe("https://x/foo");
  });

  it("prepends slash to relative paths", async () => {
    const fetchImpl = mock(() => Promise.resolve(mockResponse({})));
    const client = new ApiClient({
      apiUrl: "https://x",
      token: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.request("foo");
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe("https://x/foo");
  });

  it("sends JSON body and Content-Type", async () => {
    const fetchImpl = mock(() => Promise.resolve(mockResponse({ ok: true })));
    const client = new ApiClient({
      apiUrl: "https://x",
      token: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.request("/api/v1/foo", { method: "POST", body: { name: "x" } });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1] as unknown as RequestInit;
    expect(init.body).toBe(JSON.stringify({ name: "x" }));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  it("adds query params and skips undefined", async () => {
    const fetchImpl = mock(() => Promise.resolve(mockResponse({})));
    const client = new ApiClient({
      apiUrl: "https://x",
      token: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.request("/api/v1/foo", {
      query: { page: 2, q: "abc", skip: undefined },
    });
    const url = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[0] as unknown as string;
    expect(url).toContain("page=2");
    expect(url).toContain("q=abc");
    expect(url).not.toContain("skip");
  });

  it("returns undefined for empty response body", async () => {
    const fetchImpl = mock(() => Promise.resolve(new Response(null, { status: 204 })));
    const client = new ApiClient({
      apiUrl: "https://x",
      token: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const data = await client.request<void>("/api/v1/foo", { method: "DELETE" });
    expect(data).toBeUndefined();
  });

  it("throws ApiError on 4xx with parsed structured error code", async () => {
    const fetchImpl = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: "not_found", message: "Missing", details: { id: "x" } },
          }),
          { status: 404 },
        ),
      ),
    );
    const client = new ApiClient({
      apiUrl: "https://x",
      token: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const err = await client.request("/api/v1/missing").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).code).toBe("not_found");
    expect((err as ApiError).message).toBe("Missing");
    expect((err as ApiError).details).toEqual({ id: "x" });
  });

  it("falls back to http_<status> with default message for empty error body", async () => {
    const fetchImpl = mock(() =>
      Promise.resolve(new Response("", { status: 500, statusText: "Server Down" })),
    );
    const client = new ApiClient({
      apiUrl: "https://x",
      token: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const err = await client.request("/api/v1/foo").catch((e) => e);
    expect((err as ApiError).code).toBe("http_500");
    expect((err as ApiError).message).toBe("Internal server error");
  });

  it("handles non-JSON error body as plain text message", async () => {
    const fetchImpl = mock(() =>
      Promise.resolve(new Response("plain text error", { status: 500 })),
    );
    const client = new ApiClient({
      apiUrl: "https://x",
      token: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const err = await client.request("/api/v1/foo").catch((e) => e);
    expect((err as ApiError).message).toBe("plain text error");
  });

  it("wraps fetch failures in NetworkError", async () => {
    const fetchImpl = mock(() => Promise.reject(new Error("ECONNREFUSED")));
    const client = new ApiClient({
      apiUrl: "https://x",
      token: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const err = await client.request("/api/v1/foo").catch((e) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).cause).toBeInstanceOf(Error);
  });

  it("supports PATCH and DELETE methods", async () => {
    const fetchImpl = mock(() => Promise.resolve(mockResponse({ ok: true })));
    const client = new ApiClient({
      apiUrl: "https://x",
      token: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.request("/a", { method: "PATCH", body: { x: 1 } });
    await client.request("/b", { method: "DELETE" });
    expect(((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1] as unknown as RequestInit).method).toBe("PATCH");
    expect(((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1] as unknown as RequestInit).method).toBe("DELETE");
  });
});
