import { describe, it, expect } from "bun:test";
import {
  isInsecureOptIn,
  isLoopbackHost,
  parseApiUrl,
  InsecureApiUrlError,
} from "../lib/api-url.js";

describe("isLoopbackHost", () => {
  it("recognizes loopback hosts", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("api.localhost")).toBe(true);
  });

  it("rejects remote hosts", () => {
    expect(isLoopbackHost("app.senecabot.com")).toBe(false);
    expect(isLoopbackHost("evil.tld")).toBe(false);
  });
});

describe("parseApiUrl", () => {
  it("accepts https for any host", () => {
    expect(parseApiUrl("https://app.senecabot.com").host).toBe(
      "app.senecabot.com",
    );
  });

  it("accepts http for loopback (local dev)", () => {
    expect(parseApiUrl("http://localhost:3002").host).toBe("localhost:3002");
    expect(parseApiUrl("http://127.0.0.1:3000").hostname).toBe("127.0.0.1");
  });

  it("rejects plaintext http to a remote host", () => {
    expect(() => parseApiUrl("http://evil.tld")).toThrow(InsecureApiUrlError);
  });

  it("allows remote http only with the insecure opt-in", () => {
    expect(parseApiUrl("http://evil.tld", { allowInsecure: true }).host).toBe(
      "evil.tld",
    );
  });

  it("rejects non-http(s) schemes", () => {
    expect(() => parseApiUrl("ftp://example.com")).toThrow(/http or https/);
  });

  it("rejects an invalid URL", () => {
    expect(() => parseApiUrl("not-a-url")).toThrow(/not a valid URL/);
  });
});

describe("isInsecureOptIn", () => {
  it("is true only for explicit truthy values", () => {
    expect(isInsecureOptIn({ SNCB_INSECURE: "1" })).toBe(true);
    expect(isInsecureOptIn({ SNCB_INSECURE: "true" })).toBe(true);
    expect(isInsecureOptIn({ SNCB_INSECURE: "off" })).toBe(false);
    expect(isInsecureOptIn({})).toBe(false);
  });
});
