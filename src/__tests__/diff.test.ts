import { describe, it, expect } from "bun:test";
import {
  lineDiff,
  diffStats,
  renderDiff,
  DiffTooLargeError,
} from "../lib/diff.js";

describe("lineDiff", () => {
  it("returns all-keep hunks when inputs are identical", () => {
    const hunks = lineDiff("a\nb\nc", "a\nb\nc");
    expect(hunks).toEqual([
      { op: "keep", line: "a" },
      { op: "keep", line: "b" },
      { op: "keep", line: "c" },
    ]);
  });

  it("returns single-string short-circuit when both empty", () => {
    const hunks = lineDiff("", "");
    expect(hunks).toEqual([{ op: "keep", line: "" }]);
  });

  it("detects an added line", () => {
    const hunks = lineDiff("a\nb", "a\nNEW\nb");
    expect(hunks).toContainEqual({ op: "add", line: "NEW" });
    expect(hunks.filter((h) => h.op === "keep")).toHaveLength(2);
  });

  it("detects a removed line", () => {
    const hunks = lineDiff("a\nGONE\nb", "a\nb");
    expect(hunks).toContainEqual({ op: "remove", line: "GONE" });
    expect(hunks.filter((h) => h.op === "keep")).toHaveLength(2);
  });

  it("detects a replaced line as remove + add", () => {
    const hunks = lineDiff("a\nb\nc", "a\nB\nc");
    const ops = hunks.map((h) => `${h.op}:${h.line}`);
    expect(ops).toContain("remove:b");
    expect(ops).toContain("add:B");
  });

  it("handles fully disjoint inputs (all add + all remove)", () => {
    const hunks = lineDiff("a\nb", "x\ny");
    expect(hunks.filter((h) => h.op === "remove").map((h) => h.line)).toEqual(["a", "b"]);
    expect(hunks.filter((h) => h.op === "add").map((h) => h.line)).toEqual(["x", "y"]);
  });

  it("throws DiffTooLargeError for inputs above LCS cell limit", () => {
    // 5000 lines each => (5001)*(5001) > 10M cells
    const huge = Array.from({ length: 5000 }, (_, i) => `line-${i}`).join("\n");
    const otherHuge = Array.from({ length: 5000 }, (_, i) => `other-${i}`).join("\n");
    expect(() => lineDiff(huge, otherHuge)).toThrow(DiffTooLargeError);
  });

  it("DiffTooLargeError carries the cell count for callers to log", () => {
    const huge = Array.from({ length: 5000 }, (_, i) => `a-${i}`).join("\n");
    const other = Array.from({ length: 5000 }, (_, i) => `b-${i}`).join("\n");
    try {
      lineDiff(huge, other);
      throw new Error("expected DiffTooLargeError");
    } catch (err) {
      expect(err).toBeInstanceOf(DiffTooLargeError);
      expect((err as DiffTooLargeError).cells).toBeGreaterThan(10_000_000);
    }
  });
});

describe("diffStats", () => {
  it("counts add/remove/keep correctly", () => {
    const hunks = lineDiff("a\nb\nc", "a\nB\nc\nD");
    const stats = diffStats(hunks);
    // a kept, b->B (1 remove + 1 add), c kept, D added
    expect(stats.added).toBe(2);
    expect(stats.removed).toBe(1);
    expect(stats.kept).toBe(2);
  });

  it("returns zeros for empty hunks", () => {
    expect(diffStats([])).toEqual({ added: 0, removed: 0, kept: 0 });
  });
});

describe("renderDiff", () => {
  const hunks = lineDiff("a\nb\nc", "a\nB\nc");

  it("prefixes added lines with '+ ' and removed with '- '", () => {
    const out = renderDiff(hunks, { color: false });
    expect(out).toContain("+ B");
    expect(out).toContain("- b");
  });

  it("preserves +/- prefixes regardless of color setting", () => {
    // The ansi helper itself is gated on process.stdout.isTTY, so in a non-TTY
    // test environment the color=true path produces the same characters as
    // color=false. We assert structure (prefixes preserved) not raw escapes.
    const colored = renderDiff(hunks, { color: true });
    const plain = renderDiff(hunks, { color: false });
    expect(colored).toContain("+ B");
    expect(plain).toContain("+ B");
    expect(colored).toContain("- b");
    expect(plain).toContain("- b");
  });

  it("collapses far-away unchanged lines into a skip marker", () => {
    const big = Array.from({ length: 20 }, (_, i) => `line-${i}`).join("\n");
    const changed = big.replace("line-10", "CHANGED");
    const out = renderDiff(lineDiff(big, changed), { color: false, context: 2 });
    expect(out).toContain("@@ skipped");
    expect(out).toContain("- line-10");
    expect(out).toContain("+ CHANGED");
  });

  it("collapses pure-keep input into a single skip marker (no changes nearby)", () => {
    // With no add/remove anywhere, the context window logic flags every kept
    // line as 'outside any window', so the whole block collapses to one marker.
    const out = renderDiff(
      [
        { op: "keep", line: "a" },
        { op: "keep", line: "b" },
      ],
      { color: false },
    );
    expect(out).toBe("@@ skipped 2 unchanged lines @@");
  });

  it("honours context=0 (no surrounding lines)", () => {
    const out = renderDiff(lineDiff("a\nb\nc\nd\ne", "a\nB\nc\nD\ne"), {
      color: false,
      context: 0,
    });
    // No keep lines should appear in the output - all collapse to skipped
    expect(out).not.toContain("  a");
    expect(out).not.toContain("  c");
    expect(out).toContain("- b");
    expect(out).toContain("+ B");
  });
});
