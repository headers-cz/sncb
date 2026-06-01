import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { buildAuditCommand } from "../commands/audit.js";

function fakeTty(input: string): {
  stdin: Readable & { isTTY?: boolean };
  stdout: NodeJS.WritableStream & { isTTY?: boolean };
  written: string[];
} {
  const stdin = Readable.from([input]) as Readable & { isTTY?: boolean };
  stdin.isTTY = true;
  const written: string[] = [];
  const stdout = {
    isTTY: true,
    write: (chunk: string | Buffer): boolean => {
      written.push(chunk.toString());
      return true;
    },
  } as unknown as NodeJS.WritableStream & { isTTY?: boolean };
  return { stdin, stdout, written };
}

let tempBase: string;
let auditFile: string;
let logs: string[];
let log: (msg: string) => void;
let err: (msg: string) => void;
let errs: string[];
const ORIG_XDG_STATE = process.env["XDG_STATE_HOME"];
let origStdinIsTTY: boolean | undefined;
let origStdoutIsTTY: boolean | undefined;

beforeEach(async () => {
  origStdinIsTTY = (process.stdin as { isTTY?: boolean }).isTTY;
  origStdoutIsTTY = (process.stdout as { isTTY?: boolean }).isTTY;
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
  tempBase = await mkdtemp(join(tmpdir(), "sncb-audit-cmd-"));
  process.env["XDG_STATE_HOME"] = tempBase;
  auditFile = join(tempBase, "sncb", "audit.log");
  await mkdir(join(tempBase, "sncb"), { recursive: true });
  logs = [];
  errs = [];
  log = (msg: string): void => {
    logs.push(msg);
  };
  err = (msg: string): void => {
    errs.push(msg);
  };
});

afterEach(async () => {
  Object.defineProperty(process.stdin, "isTTY", { value: origStdinIsTTY, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: origStdoutIsTTY, configurable: true });
  if (ORIG_XDG_STATE === undefined) {
    delete process.env["XDG_STATE_HOME"];
  } else {
    process.env["XDG_STATE_HOME"] = ORIG_XDG_STATE;
  }
  await rm(tempBase, { recursive: true, force: true });
});

async function writeEntries(entries: Record<string, unknown>[]): Promise<void> {
  await writeFile(
    auditFile,
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
}

async function run(...argv: string[]): Promise<void> {
  const cmd = buildAuditCommand({ log, err });
  cmd.exitOverride();
  await cmd.parseAsync(argv, { from: "user" });
}

describe("audit path", () => {
  it("prints the audit log file path", async () => {
    await run("path");
    expect(logs[0]).toBe(auditFile);
  });
});

describe("audit tail", () => {
  beforeEach(async () => {
    await writeEntries([
      { ts: "2026-05-14T10:00:00.000Z", pid: 1, cmd: "website list", args: [], flags: {}, endpoint: "GET /api/v1/websites", status: 200, duration_ms: 30, outcome: "ok", items_count: 3 },
      { ts: "2026-05-14T11:00:00.000Z", pid: 2, cmd: "page delete", args: ["abc"], flags: { yes: true }, endpoint: "DELETE /api/v1/pages/abc", status: 404, duration_ms: 15, outcome: "error", error_code: "not_found" },
      { ts: "2026-05-14T12:00:00.000Z", pid: 3, cmd: "page get", args: ["xyz"], flags: {}, endpoint: "GET /api/v1/pages/xyz", status: 200, duration_ms: 20, outcome: "ok" },
    ]);
  });

  it("prints the entries in human-readable format", async () => {
    await run("tail");
    expect(logs).toHaveLength(3);
    expect(logs[0]).toContain("website list");
    expect(logs[0]).toContain("3 items");
    expect(logs[1]).toContain("page delete");
    expect(logs[1]).toContain("--yes");
    expect(logs[1]).toContain("not_found");
    expect(logs[2]).toContain("page get");
  });

  it("limits to --last N", async () => {
    await run("tail", "--last", "1");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("page get");
  });

  it("filters by --filter substring", async () => {
    await run("tail", "--filter", "page");
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.includes("page"))).toBe(true);
  });

  it("emits JSONL with --json", async () => {
    await run("tail", "--json");
    expect(logs).toHaveLength(3);
    for (const line of logs) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("prints friendly message when log is empty", async () => {
    await rm(auditFile, { force: true });
    await run("tail");
    expect(logs[0]).toBe("No audit entries yet.");
  });
});

describe("audit clear", () => {
  beforeEach(async () => {
    await writeEntries([
      { ts: "2020-01-01T00:00:00.000Z", pid: 1, cmd: "old", args: [], flags: {}, outcome: "ok" },
      { ts: new Date().toISOString(), pid: 1, cmd: "recent", args: [], flags: {}, outcome: "ok" },
    ]);
  });

  it("with --yes and --older-than keeps newer entries", async () => {
    await run("clear", "--older-than", "30d", "--yes");
    const remaining = (await readFile(auditFile, "utf-8")).trim().split("\n");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toContain("recent");
    expect(logs[0]).toMatch(/Deleted 1 entries.*1 kept/);
  });

  it("with --yes (no filter) clears everything", async () => {
    await run("clear", "--yes");
    await expect(readFile(auditFile, "utf-8")).rejects.toThrow();
    expect(logs[0]).toMatch(/Deleted 2 entries/);
  });

  it("refuses in non-TTY without --yes", async () => {
    await run("clear");
    expect(errs.some((m) => m.includes("non-interactive"))).toBe(true);
  });

  it("uses the default stderr err callback when none is injected", async () => {
    let written = "";
    const spy = spyOn(process.stderr, "write").mockImplementation(((c: unknown) => {
      written += String(c);
      return true;
    }) as typeof process.stderr.write);
    try {
      const cmd = buildAuditCommand({ log }); // no err dep -> default stderr err
      cmd.exitOverride();
      await cmd.parseAsync(["clear"], { from: "user" });
    } finally {
      spy.mockRestore();
    }
    expect(written).toContain("refusing to clear audit log");
  });
});

describe("audit clear (interactive TTY)", () => {
  beforeEach(async () => {
    await writeEntries([
      { ts: new Date().toISOString(), pid: 1, cmd: "a", args: [], flags: {}, outcome: "ok" },
      { ts: new Date().toISOString(), pid: 1, cmd: "b", args: [], flags: {}, outcome: "ok" },
    ]);
  });

  it("clears after a 'y' confirmation", async () => {
    const { stdin, stdout, written } = fakeTty("y\n");
    const cmd = buildAuditCommand({ log, err, stdin, stdout });
    cmd.exitOverride();
    await cmd.parseAsync(["clear"], { from: "user" });
    expect(written.join("")).toContain("Delete ALL audit entries?");
    expect(logs.join("\n")).toMatch(/Deleted 2 entries/);
  });

  it("aborts when the user does not confirm", async () => {
    const { stdin, stdout } = fakeTty("n\n");
    const cmd = buildAuditCommand({ log, err, stdin, stdout });
    cmd.exitOverride();
    await cmd.parseAsync(["clear"], { from: "user" });
    expect(errs.some((m) => m.includes("Aborted"))).toBe(true);
  });

  it("shows the older-than prompt variant", async () => {
    const { stdin, stdout, written } = fakeTty("y\n");
    const cmd = buildAuditCommand({ log, err, stdin, stdout });
    cmd.exitOverride();
    await cmd.parseAsync(["clear", "--older-than", "30d"], { from: "user" });
    expect(written.join("")).toContain("older than 30d");
  });
});

describe("audit tail parsing", () => {
  beforeEach(async () => {
    await writeEntries([
      { ts: new Date().toISOString(), pid: 1, cmd: "recent", args: [], flags: {}, outcome: "ok" },
      { ts: "2020-01-01T00:00:00.000Z", pid: 1, cmd: "old", args: [], flags: {}, outcome: "ok" },
    ]);
  });

  it("filters by --since duration", async () => {
    await run("tail", "--since", "1h");
    expect(logs.some((l) => l.includes("recent"))).toBe(true);
    expect(logs.some((l) => l.includes("old"))).toBe(false);
  });

  it("rejects an invalid --since duration", async () => {
    await expect(run("tail", "--since", "soon")).rejects.toThrow(/Invalid duration/);
  });

  it("rejects an invalid --last value", async () => {
    await expect(run("tail", "--last", "0")).rejects.toThrow(/positive integer/);
  });
});
