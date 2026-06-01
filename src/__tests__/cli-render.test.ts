import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { renderError, deriveArgs } from "../cli.js";
import { ApiError, NetworkError, AuthRequiredError } from "../api/errors.js";
import { ConfirmationRequiredError } from "../lib/confirm.js";

let stderr: string;
let spy: ReturnType<typeof spyOn>;

beforeEach(() => {
  stderr = "";
  spy = spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write);
});

afterEach(() => {
  spy.mockRestore();
});

describe("renderError", () => {
  it("prints an ApiError with an invalid_token hint", () => {
    renderError(new ApiError(401, "invalid_token", "bad token"));
    expect(stderr).toContain("API error (401 invalid_token)");
    expect(stderr).toContain("hint:");
    expect(stderr).toContain("auth login");
  });

  it("hints on insufficient_scope", () => {
    renderError(new ApiError(403, "insufficient_scope", "nope"));
    expect(stderr).toContain("read access");
  });

  it("hints with retry seconds on rate_limit_exceeded", () => {
    renderError(
      new ApiError(429, "rate_limit_exceeded", "slow down", { retry_after_seconds: 7 }),
    );
    expect(stderr).toContain("Retry in 7s");
  });

  it("hints without retry when retry_after_seconds is not a number", () => {
    renderError(new ApiError(429, "rate_limit_exceeded", "slow down", {}));
    expect(stderr).toContain("rate limit hit.");
    expect(stderr).not.toContain("Retry in");
  });

  it("hints on validation_failed", () => {
    renderError(new ApiError(422, "validation_failed", "bad body"));
    expect(stderr).toContain("failed validation");
  });

  it("hints by status: 404, 409, 5xx", () => {
    renderError(new ApiError(404, "x", "m"));
    expect(stderr).toContain("not found");
    stderr = "";
    renderError(new ApiError(409, "x", "m"));
    expect(stderr).toContain("conflicts");
    stderr = "";
    renderError(new ApiError(500, "x", "m"));
    expect(stderr).toContain("server-side error");
  });

  it("prints an ApiError with no hint for an unmapped 4xx", () => {
    renderError(new ApiError(418, "teapot", "short and stout"));
    expect(stderr).toContain("teapot");
    expect(stderr).not.toContain("hint:");
  });

  it("strips control sequences from server-controlled error fields", () => {
    renderError(new ApiError(400, "bad\x1b[31m", "evil\x1b]0;pwn\x07"));
    expect(stderr).not.toContain("\x1b");
  });

  it("prints a NetworkError with its hint", () => {
    renderError(new NetworkError("Failed to reach https://x", new Error("dns")));
    expect(stderr).toContain("Network error");
    expect(stderr).toContain("config get apiUrl");
  });

  it("prints an AuthRequiredError message", () => {
    renderError(new AuthRequiredError());
    expect(stderr).toContain("Not authenticated");
  });

  it("prints a ConfirmationRequiredError with the --yes hint", () => {
    renderError(new ConfirmationRequiredError());
    expect(stderr).toContain("rerun with --yes");
  });

  it("prints a generic Error message", () => {
    renderError(new Error("boom"));
    expect(stderr).toContain("boom");
  });

  it("stringifies a non-Error value", () => {
    renderError("plain string failure");
    expect(stderr).toContain("plain string failure");
  });
});

describe("deriveArgs", () => {
  it("skips the value after a value-taking flag (token never captured)", () => {
    const args = deriveArgs([
      "node",
      "sncb",
      "--token",
      "snc_live_abcdefghijklmnopqrstuvwxyz0123456789",
      "website",
      "list",
    ]);
    expect(args).toEqual([]);
  });

  it("skips -o/--output values too", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const args = deriveArgs(["node", "sncb", "-o", "json", "page", "get", id]);
    expect(args).toEqual([id]); // the uuid is captured; "json" (the -o value) is not
    expect(args).not.toContain("json");
  });

  it("redacts a token-shaped positional argument", () => {
    const args = deriveArgs(["node", "sncb", "x", `snc_test_${"z".repeat(40)}`]);
    expect(args).toContain("<redacted>");
    expect(args.join(" ")).not.toContain("snc_test_");
  });
});
