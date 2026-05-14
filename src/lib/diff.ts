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

export function lineDiff(a: string, b: string): DiffHunk[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const n = aLines.length;
  const m = bLines.length;

  // LCS length table
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

/**
 * Render hunks as a coloured unified-style listing. Context lines outside
 * the requested window around changes are collapsed into `@@ skipped N @@`
 * markers so output is readable for big files.
 */
export function renderDiff(
  hunks: DiffHunk[],
  options: { color?: boolean; context?: number } = {},
): string {
  const color = options.color ?? true;
  const context = options.context ?? 3;

  // Mark which kept-lines fall within `context` of a changed line.
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
  for (let k = 0; k < hunks.length; k++) {
    const h = hunks[k]!;
    if (h.op === "keep" && !inWindow[k]) {
      skipped++;
      continue;
    }
    if (skipped > 0) {
      out.push(color ? `\x1b[36m@@ skipped ${skipped} unchanged lines @@\x1b[0m` : `@@ skipped ${skipped} unchanged lines @@`);
      skipped = 0;
    }
    if (h.op === "add") {
      out.push(color ? `\x1b[32m+ ${h.line}\x1b[0m` : `+ ${h.line}`);
    } else if (h.op === "remove") {
      out.push(color ? `\x1b[31m- ${h.line}\x1b[0m` : `- ${h.line}`);
    } else {
      out.push(`  ${h.line}`);
    }
  }
  if (skipped > 0) {
    out.push(color ? `\x1b[36m@@ skipped ${skipped} unchanged lines @@\x1b[0m` : `@@ skipped ${skipped} unchanged lines @@`);
  }
  return out.join("\n");
}
