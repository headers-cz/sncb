import { ansi } from "./ansi.js";

/**
 * Minimal line-based diff for CLI output. Uses an LCS table (O(n*m) time and
 * space) which is fine for page content - we are not diffing source trees.
 * Output is a list of hunks: kept lines unchanged, removed lines prefixed `-`,
 * added lines prefixed `+`. Apply colours at the caller (so JSON consumers can
 * read raw hunks).
 */

export type DiffOp = "keep" | "add" | "remove";

export interface DiffHunk {
  op: DiffOp;
  line: string;
}

// 10M cells in the LCS table (n+1)*(m+1) of number == ~80MB at 8 bytes each.
// Page content beyond this is almost certainly not text we want to line-diff.
const LCS_MAX_CELLS = 10_000_000;

export class DiffTooLargeError extends Error {
  constructor(public readonly cells: number) {
    super(
      `Content too large to line-diff (${cells} LCS cells exceeds limit ${LCS_MAX_CELLS}). ` +
        `Pipe content through an external tool instead.`,
    );
    this.name = "DiffTooLargeError";
  }
}

export function lineDiff(a: string, b: string): DiffHunk[] {
  if (a === b) return a.split("\n").map((line) => ({ op: "keep" as const, line }));

  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const n = aLines.length;
  const m = bLines.length;

  if ((n + 1) * (m + 1) > LCS_MAX_CELLS) {
    throw new DiffTooLargeError((n + 1) * (m + 1));
  }

  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) {
        lcs[i]![j] = lcs[i + 1]![j + 1]! + 1;
      } else {
        lcs[i]![j] = Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
      }
    }
  }

  const hunks: DiffHunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      hunks.push({ op: "keep", line: aLines[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      hunks.push({ op: "remove", line: aLines[i]! });
      i++;
    } else {
      hunks.push({ op: "add", line: bLines[j]! });
      j++;
    }
  }
  while (i < n) {
    hunks.push({ op: "remove", line: aLines[i]! });
    i++;
  }
  while (j < m) {
    hunks.push({ op: "add", line: bLines[j]! });
    j++;
  }
  return hunks;
}

export interface DiffStats {
  added: number;
  removed: number;
  kept: number;
}

export function diffStats(hunks: DiffHunk[]): DiffStats {
  let added = 0;
  let removed = 0;
  let kept = 0;
  for (const h of hunks) {
    if (h.op === "add") added++;
    else if (h.op === "remove") removed++;
    else kept++;
  }
  return { added, removed, kept };
}

export function renderDiff(
  hunks: DiffHunk[],
  options: { color?: boolean; context?: number } = {},
): string {
  const useColor = options.color ?? true;
  const context = options.context ?? 3;
  const add = useColor ? ansi.green : (s: string): string => s;
  const remove = useColor ? ansi.red : (s: string): string => s;
  const skipMarker = useColor ? ansi.cyan : (s: string): string => s;

  const inWindow = new Array<boolean>(hunks.length).fill(false);
  for (let k = 0; k < hunks.length; k++) {
    if (hunks[k]!.op !== "keep") {
      for (let w = Math.max(0, k - context); w <= Math.min(hunks.length - 1, k + context); w++) {
        inWindow[w] = true;
      }
    }
  }

  const out: string[] = [];
  let skipped = 0;
  const flushSkipped = (): void => {
    if (skipped > 0) {
      out.push(skipMarker(`@@ skipped ${skipped} unchanged lines @@`));
      skipped = 0;
    }
  };
  for (let k = 0; k < hunks.length; k++) {
    const h = hunks[k]!;
    if (h.op === "keep" && !inWindow[k]) {
      skipped++;
      continue;
    }
    flushSkipped();
    if (h.op === "add") out.push(add(`+ ${h.line}`));
    else if (h.op === "remove") out.push(remove(`- ${h.line}`));
    else out.push(`  ${h.line}`);
  }
  flushSkipped();
  return out.join("\n");
}
