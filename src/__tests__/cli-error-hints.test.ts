import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { ApiError, NetworkError, AuthRequiredError } from "../api/errors.js";
import { renderError } from "../cli.js";

let stderrSpy: ReturnType<typeof spyOn>;
let output: string[];

beforeEach(() => {
  output = [];
  stderrSpy = spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    output.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  stderrSpy.mockRestore();
});

describe("renderError - actionable hints", () => {
  it("suggests sncb auth login for invalid_token", () => {
    renderError(new ApiError(401, "invalid_token", "Missing or invalid API token"));
    const text = output.join("");
    expect(text).toContain("invalid_token");
    expect(text).toContain("sncb auth login");
  });

  it("suggests write-scoped token for insufficient_scope", () => {
    renderError(new ApiError(403, "insufficient_scope", "Forbidden"));
    const text = output.join("");
    expect(text).toContain("insufficient_scope");
    expect(text).toContain("write-scoped token");
  });

  it("surfaces retry-after seconds from rate_limit_exceeded details", () => {
    renderError(
      new ApiError(429, "rate_limit_exceeded", "Slow down", {
        retry_after_seconds: 42,
      }),
    );
    const text = output.join("");
    expect(text).toContain("Retry in 42s");
  });

  it("explains 404 as missing-or-wrong-org", () => {
    renderError(new ApiError(404, "not_found", "Page xyz not found"));
    const text = output.join("");
    expect(text).toContain("not found");
    expect(text).toContain("different organization");
  });

  it("explains 409 as conflict (e.g. duplicate slug)", () => {
    renderError(new ApiError(409, "conflict", "slug already exists"));
    expect(output.join("")).toContain("conflict");
  });

  it("suggests retry for 5xx", () => {
    renderError(new ApiError(500, "internal_error", "Server down"));
    const text = output.join("");
    expect(text).toContain("server-side error");
    expect(text).toContain("Retry");
  });

  it("hints at apiUrl/connectivity for NetworkError", () => {
    renderError(new NetworkError("Failed to reach https://x", new Error("ECONNREFUSED")));
    const text = output.join("");
    expect(text).toContain("Network error");
    expect(text).toContain("sncb config get apiUrl");
  });

  it("prints AuthRequiredError message verbatim (already actionable)", () => {
    renderError(new AuthRequiredError());
    expect(output.join("")).toContain("sncb auth login");
  });

  it("does not emit a hint for ApiError codes we don't have hints for", () => {
    renderError(new ApiError(418, "im_a_teapot", "Brewing"));
    expect(output.join("")).not.toContain("hint:");
  });
});
