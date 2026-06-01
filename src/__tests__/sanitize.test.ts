import { describe, it, expect } from "bun:test";
import { stripControl } from "../lib/sanitize.js";

const PLACEHOLDER = "\uFFFD";
const ESC = "\x1b";

describe("stripControl", () => {
  it("strips the ESC byte that starts every ANSI sequence", () => {
    const out = stripControl(`safe${ESC}[31mred${ESC}[0m`);
    expect(out).not.toContain(ESC);
    expect(out).toContain(PLACEHOLDER);
    expect(out).toContain("safe");
  });

  it("strips carriage return so output cannot be overwritten", () => {
    expect(stripControl("done\rfake")).toBe(`done${PLACEHOLDER}fake`);
  });

  it("strips C1 control bytes (0x80-0x9F)", () => {
    expect(stripControl("a\u0085b")).toBe(`a${PLACEHOLDER}b`);
  });

  it("folds TAB and LF by default (single-line contexts)", () => {
    expect(stripControl("a\tb\nc")).toBe(`a${PLACEHOLDER}b${PLACEHOLDER}c`);
  });

  it("preserves TAB and LF with { multiline: true }", () => {
    expect(stripControl("a\tb\nc", { multiline: true })).toBe("a\tb\nc");
  });

  it("still strips ESC and CR in multiline mode", () => {
    expect(stripControl(`a${ESC}b\rc`, { multiline: true })).toBe(
      `a${PLACEHOLDER}b${PLACEHOLDER}c`,
    );
  });

  it("leaves printable Unicode (incl. accents) untouched", () => {
    const accented = "café žluťoučký";
    expect(stripControl(accented)).toBe(accented);
  });

  it("is a no-op for clean ASCII", () => {
    expect(stripControl("page-title (abc-123)")).toBe("page-title (abc-123)");
  });
});
