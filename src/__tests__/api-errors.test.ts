import { describe, it, expect } from "bun:test";
import {
  ApiError,
  AuthRequiredError,
  NetworkError,
  exitCodeForError,
} from "../api/errors.js";

describe("ApiError", () => {
  it("stores status, code, message, details", () => {
    const err = new ApiError(400, "bad_request", "x", { foo: "bar" });
    expect(err.status).toBe(400);
    expect(err.code).toBe("bad_request");
    expect(err.message).toBe("x");
    expect(err.details).toEqual({ foo: "bar" });
    expect(err.name).toBe("ApiError");
  });
});

describe("NetworkError", () => {
  it("preserves cause", () => {
    const cause = new Error("dns");
    const err = new NetworkError("net", cause);
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("NetworkError");
  });
});

describe("AuthRequiredError", () => {
  it("uses friendly message", () => {
    const err = new AuthRequiredError();
    expect(err.message).toMatch(/sncb auth login/);
  });
});

describe("exitCodeForError", () => {
  it("returns 4 for AuthRequiredError", () => {
    expect(exitCodeForError(new AuthRequiredError())).toBe(4);
  });
  it("returns 2 for 5xx ApiError", () => {
    expect(exitCodeForError(new ApiError(500, "x", "y"))).toBe(2);
  });
  it("returns 1 for 4xx ApiError", () => {
    expect(exitCodeForError(new ApiError(404, "x", "y"))).toBe(1);
  });
  it("returns 3 for NetworkError", () => {
    expect(exitCodeForError(new NetworkError("x", new Error()))).toBe(3);
  });
  it("returns 1 for generic Error", () => {
    expect(exitCodeForError(new Error("oops"))).toBe(1);
  });
});
