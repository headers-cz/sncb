import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  endInvocation,
  getAuditPaths,
  readAuditEntries,
  clearAuditEntries,
  recordHttpCall,
  recordResponseMetadata,
  startInvocation,
  isAuditEnabled,
  type AuditPaths,
} from "../lib/audit.js";
import { deriveArgs, deriveCommandPath } from "../cli.js";

let tempBase: string;
let paths: AuditPaths;
const ORIG_XDG_STATE = process.env["XDG_STATE_HOME"];

beforeEach(async () => {
  tempBase = await mkdtemp(join(tmpdir(), "sncb-audit-"));
  process.env["XDG_STATE_HOME"] = tempBase;
  paths = { dir: join(tempBase, "sncb"), file: join(tempBase, "sncb", "audit.log") };
});

afterEach(async () => {
  if (ORIG_XDG_STATE === undefined) {
    delete process.env["XDG_STATE_HOME"];
  } else {
    process.env["XDG_STATE_HOME"] = ORIG_XDG_STATE;
  }
  delete process.env["SNCB_AUDIT"];
  await rm(tempBase, { recursive: true, force: true });
});

describe("isAuditEnabled", () => {
  it("returns true by default", () => {
    expect(isAuditEnabled()).toBe(true);
  });

  it("respects SNCB_AUDIT=off", () => {
    process.env["SNCB_AUDIT"] = "off";
    expect(isAuditEnabled()).toBe(false);
  });

  it("respects SNCB_AUDIT=false / 0", () => {
    process.env["SNCB_AUDIT"] = "false";
    expect(isAuditEnabled()).toBe(false);
    process.env["SNCB_AUDIT"] = "0";
    expect(isAuditEnabled()).toBe(false);
  });
});

describe("getAuditPaths", () => {
  it("respects XDG_STATE_HOME env", () => {
    process.env["XDG_STATE_HOME"] = "/custom";
    const p = getAuditPaths();
    expect(p.file).toBe("/custom/sncb/audit.log");
  });

  it("falls back to ~/.local/state/sncb when XDG_STATE_HOME is not set", () => {
    delete process.env["XDG_STATE_HOME"];
    const p = getAuditPaths("/home/test");
    expect(p.file).toBe("/home/test/.local/state/sncb/audit.log");
  });
});

describe("invocation lifecycle", () => {
  it("writes a JSONL entry with command, args, and outcome", async () => {
    startInvocation({ cmd: "website list", args: [], flags: { verbose: false } });
    recordHttpCall({
      method: "GET",
      path: "/api/v1/websites",
      apiUrl: "https://test",
      status: 200,
      durationMs: 42,
    });
    recordResponseMetadata({ itemsCount: 3 });
    await endInvocation("ok", undefined, paths);

    const text = await readFile(paths.file, "utf-8");
    const entries = text.trim().split("\n").map((l) => JSON.parse(l));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      cmd: "website list",
      args: [],
      outcome: "ok",
      endpoint: "GET /api/v1/websites",
      status: 200,
      duration_ms: 42,
      items_count: 3,
      api_url: "https://test",
    });
    expect(entries[0].ts).toBeDefined();
    expect(entries[0].pid).toBe(process.pid);
  });

  it("records error_code on failed invocations", async () => {
    startInvocation({ cmd: "page get", args: ["x"], flags: {} });
    recordHttpCall({
      method: "GET",
      path: "/api/v1/pages/x",
      apiUrl: "https://test",
      status: 404,
      durationMs: 15,
    });
    await endInvocation("error", "not_found", paths);
    const entries = await readAuditEntries(paths);
    expect(entries[0]).toMatchObject({
      cmd: "page get",
      outcome: "error",
      error_code: "not_found",
      status: 404,
    });
  });

  it("never writes the token even if passed in flags", async () => {
    startInvocation({
      cmd: "health",
      args: [],
      flags: { token: "snc_live_secret_xxx" },
    });
    await endInvocation("ok", undefined, paths);
    const entries = await readAuditEntries(paths);
    expect(entries[0]?.flags).toEqual({ token: "<redacted>" });
    // double-check the file contents directly
    const raw = await readFile(paths.file, "utf-8");
    expect(raw).not.toContain("snc_live_secret_xxx");
  });

  it("never writes a token supplied via the real --token argv pipeline", async () => {
    // Regression for the audit-log token leak: a long token after `--token`
    // used to slip through deriveArgs into args[] and onto disk. Drive the
    // exact production path (deriveCommandPath + deriveArgs -> startInvocation
    // -> endInvocation) and assert the secret never reaches the log file.
    const secret = `snc_live_${"a".repeat(40)}`;
    const argv = ["node", "sncb", "--token", secret, "website", "list"];
    startInvocation({
      cmd: deriveCommandPath(argv),
      args: deriveArgs(argv),
      flags: {},
    });
    await endInvocation("ok", undefined, paths);

    const raw = await readFile(paths.file, "utf-8");
    expect(raw).not.toContain(secret);
    const entries = await readAuditEntries(paths);
    expect(entries[0]?.cmd).toBe("website list");
    expect(entries[0]?.args).toEqual([]);
  });

  it("redacts a token-shaped positional argument as a backstop", async () => {
    const secret = `snc_live_${"b".repeat(40)}`;
    startInvocation({ cmd: "health", args: deriveArgs(["node", "sncb", secret]), flags: {} });
    await endInvocation("ok", undefined, paths);
    const raw = await readFile(paths.file, "utf-8");
    expect(raw).not.toContain(secret);
    expect(raw).toContain("<redacted>");
  });

  it("does not throw when SNCB_AUDIT=off", async () => {
    process.env["SNCB_AUDIT"] = "off";
    startInvocation({ cmd: "website list", args: [], flags: {} });
    await endInvocation("ok", undefined, paths);
    // File should not exist
    await expect(readFile(paths.file, "utf-8")).rejects.toThrow();
  });

  it("writes resource_id when recordResponseMetadata supplies one", async () => {
    startInvocation({ cmd: "page get", args: ["abc"], flags: {} });
    recordResponseMetadata({ resourceId: "abc-123" });
    await endInvocation("ok", undefined, paths);
    const entries = await readAuditEntries(paths);
    expect(entries[0]?.resource_id).toBe("abc-123");
  });
});

describe("readAuditEntries", () => {
  it("returns empty array when no file exists", async () => {
    const entries = await readAuditEntries(paths);
    expect(entries).toEqual([]);
  });

  it("skips malformed lines", async () => {
    await import("node:fs/promises").then((fs) =>
      fs.mkdir(paths.dir, { recursive: true }).then(() =>
        fs.writeFile(
          paths.file,
          '{"ts":"2026-05-14T10:00:00Z","cmd":"x","args":[],"flags":{},"outcome":"ok","pid":1}\nnot-json\n{"ts":"2026-05-14T11:00:00Z","cmd":"y","args":[],"flags":{},"outcome":"ok","pid":1}\n',
        ),
      ),
    );
    const entries = await readAuditEntries(paths);
    expect(entries.map((e) => e.cmd)).toEqual(["x", "y"]);
  });
});

describe("clearAuditEntries", () => {
  it("deletes everything when no olderThan filter is provided", async () => {
    startInvocation({ cmd: "a", args: [], flags: {} });
    await endInvocation("ok", undefined, paths);
    startInvocation({ cmd: "b", args: [], flags: {} });
    await endInvocation("ok", undefined, paths);

    const result = await clearAuditEntries({}, paths);
    expect(result.deleted).toBe(2);
    expect(result.kept).toBe(0);
    const entries = await readAuditEntries(paths);
    expect(entries).toEqual([]);
  });

  it("keeps newer entries when olderThan is set", async () => {
    const fs = await import("node:fs/promises");
    await fs.mkdir(paths.dir, { recursive: true });
    const old = JSON.stringify({
      ts: "2020-01-01T00:00:00.000Z",
      pid: 1,
      cmd: "old",
      args: [],
      flags: {},
      outcome: "ok",
    });
    const recent = JSON.stringify({
      ts: new Date().toISOString(),
      pid: 1,
      cmd: "recent",
      args: [],
      flags: {},
      outcome: "ok",
    });
    await fs.writeFile(paths.file, `${old}\n${recent}\n`);

    const cutoff = new Date(Date.now() - 60_000);
    const result = await clearAuditEntries({ olderThan: cutoff }, paths);
    expect(result.deleted).toBe(1);
    expect(result.kept).toBe(1);
    const entries = await readAuditEntries(paths);
    expect(entries.map((e) => e.cmd)).toEqual(["recent"]);
  });
});
