import { describe, it, expect } from "bun:test";
import { parseErrorBody } from "../api/errors.js";

describe("parseErrorBody", () => {
  it("parses new structured shape with code/message/details", () => {
    const out = parseErrorBody(404, {
      error: { code: "not_found", message: "Page abc", details: { id: "abc" } },
    });
    expect(out).toEqual({
      code: "not_found",
      message: "Page abc",
      details: { id: "abc" },
    });
  });

  it("falls back to http_<status> when body is empty", () => {
    expect(parseErrorBody(500, undefined).code).toBe("http_500");
    expect(parseErrorBody(500, undefined).message).toBe("Internal server error");
  });

  it("falls back to default message per status", () => {
    expect(parseErrorBody(401, undefined).message).toBe("Authentication required");
    expect(parseErrorBody(403, undefined).message).toBe("Forbidden");
    expect(parseErrorBody(404, undefined).message).toBe("Not found");
    expect(parseErrorBody(409, undefined).message).toBe("Conflict");
    expect(parseErrorBody(429, undefined).message).toBe("Rate limited");
  });

  it("handles legacy string error shape gracefully", () => {
    const out = parseErrorBody(403, { error: "forbidden" });
    expect(out.code).toBe("forbidden");
    expect(out.message).toBe("forbidden");
  });

  it("handles plain message field", () => {
    const out = parseErrorBody(500, { message: "Something exploded" });
    expect(out.code).toBe("http_500");
    expect(out.message).toBe("Something exploded");
  });
});
