import { stringify as yamlStringify } from "yaml";

export type OutputFormat = "table" | "json" | "yaml";

export interface Column<T> {
  header: string;
  value: (row: T) => string;
}

export interface RenderOptions<T> {
  format: OutputFormat;
  data: T | T[];
  columns?: Column<T>[];
}

export function render<T>(opts: RenderOptions<T>): string {
  if (opts.format === "json") return JSON.stringify(opts.data, null, 2);
  if (opts.format === "yaml") return yamlStringify(opts.data).trimEnd();
  if (!opts.columns) {
    throw new Error("Table format requires columns.");
  }
  return renderTable(Array.isArray(opts.data) ? opts.data : [opts.data], opts.columns);
}

function renderTable<T>(rows: T[], columns: Column<T>[]): string {
  if (rows.length === 0) return "(no rows)";
  const headers = columns.map((c) => c.header);
  const data = rows.map((row) => columns.map((c) => String(c.value(row) ?? "")));
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map((r) => (r[i] ?? "").length)),
  );
  const formatRow = (cells: string[]): string =>
    cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  const lines = [formatRow(headers), formatRow(widths.map((w) => "-".repeat(w)))];
  for (const row of data) lines.push(formatRow(row));
  return lines.join("\n");
}
