import { describe, it, expect } from "bun:test";
import { compareSemver, isNewer } from "../lib/version.js";

describe("compareSemver", () => {
  it("returns 0 for equal versions", () => {
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });

  it("returns 1 when first is higher patch", () => {
    expect(compareSemver("1.2.4", "1.2.3")).toBe(1);
  });

  it("returns -1 when first is lower minor", () => {
    expect(compareSemver("1.1.9", "1.2.0")).toBe(-1);
  });

  it("compares major versions correctly", () => {
    expect(compareSemver("2.0.0", "1.99.99")).toBe(1);
  });

  it("ignores pre-release suffixes", () => {
    expect(compareSemver("1.2.3-beta.1", "1.2.3")).toBe(0);
  });

  it("treats missing parts as 0", () => {
    expect(compareSemver("1", "1.0.0")).toBe(0);
    expect(compareSemver("1.1", "1.0.5")).toBe(1);
  });
});

describe("isNewer", () => {
  it("true when candidate higher", () => {
    expect(isNewer("0.2.0", "0.1.9")).toBe(true);
  });
  it("false when equal", () => {
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
  });
  it("false when older", () => {
    expect(isNewer("0.9.0", "1.0.0")).toBe(false);
  });
});
