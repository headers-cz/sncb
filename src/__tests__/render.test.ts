import { describe, it, expect } from "bun:test";
import { render, type Column } from "../output/render.js";

interface Row {
  id: string;
  name: string;
}

const cols: Column<Row>[] = [
  { header: "ID", value: (r) => r.id },
  { header: "NAME", value: (r) => r.name },
];

describe("render", () => {
  it("formats JSON pretty-printed", () => {
    const out = render({ format: "json", data: { a: 1 } });
    expect(out).toBe(JSON.stringify({ a: 1 }, null, 2));
  });

  it("formats YAML without trailing newline", () => {
    const out = render({ format: "yaml", data: { a: 1 } });
    expect(out).toBe("a: 1");
  });

  it("renders table with header underline and padding", () => {
    const rows: Row[] = [
      { id: "abc", name: "Foo" },
      { id: "de", name: "Longer Name" },
    ];
    const out = render({ format: "table", data: rows, columns: cols });
    const lines = out.split("\n");
    expect(lines[0]?.startsWith("ID")).toBe(true);
    expect(lines[0]?.includes("NAME")).toBe(true);
    expect(lines[1]).toMatch(/^-+\s+-+$/);
    expect(lines[2]).toContain("abc");
    expect(lines[3]).toContain("Longer Name");
  });

  it("wraps single object into table row", () => {
    const out = render({
      format: "table",
      data: { id: "1", name: "X" },
      columns: cols,
    });
    expect(out).toContain("1");
    expect(out).toContain("X");
  });

  it("shows (no rows) on empty list", () => {
    const out = render({ format: "table", data: [] as Row[], columns: cols });
    expect(out).toBe("(no rows)");
  });

  it("throws when table format without columns", () => {
    expect(() => render({ format: "table", data: [] })).toThrow(/columns/);
  });
});
