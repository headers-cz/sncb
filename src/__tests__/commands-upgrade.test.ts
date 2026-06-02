import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildUpgradeCommand } from "../commands/upgrade.js";
import { loadConfig } from "../config/storage.js";

interface FakeChild extends EventEmitter {
  unref(): void;
}

function makeChild(exitCode = 0): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.unref = () => undefined;
  queueMicrotask(() => child.emit("exit", exitCode));
  return child;
}

let tempHome: string;
let logs: string[];

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "sncb-up-"));
  process.env["XDG_CONFIG_HOME"] = tempHome;
  logs = [];
});

afterEach(async () => {
  delete process.env["XDG_CONFIG_HOME"];
  await rm(tempHome, { recursive: true, force: true });
});

describe("upgrade", () => {
  function fetchVersion(version: string) {
    return mock(() =>
      Promise.resolve(new Response(JSON.stringify({ version }))),
    ) as unknown as typeof fetch;
  }

  it("reports already on latest", async () => {
    const cmd = buildUpgradeCommand({
      currentVersion: "1.0.0",
      fetchImpl: fetchVersion("1.0.0"),
      log: (m) => logs.push(m),
    });
    cmd.exitOverride();
    await cmd.parseAsync([], { from: "user" });
    expect(logs.join("\n")).toContain("Already on latest");
  });

  it("reports newer version with --check (no install)", async () => {
    const spawnImpl = mock(() => makeChild()) as unknown as typeof import("node:child_process").spawn;
    const cmd = buildUpgradeCommand({
      currentVersion: "0.1.0",
      fetchImpl: fetchVersion("0.2.0"),
      spawnImpl,
      log: (m) => logs.push(m),
    });
    cmd.exitOverride();
    await cmd.parseAsync(["--check"], { from: "user" });
    expect(logs.join("\n")).toContain("New version available");
    expect(
      (spawnImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(0);
  });

  it("invokes installer when newer version", async () => {
    const spawnImpl = mock(() => makeChild()) as unknown as typeof import("node:child_process").spawn;
    const cmd = buildUpgradeCommand({
      currentVersion: "0.1.0",
      fetchImpl: fetchVersion("0.2.0"),
      spawnImpl,
      log: (m) => logs.push(m),
    });
    cmd.exitOverride();
    await cmd.parseAsync([], { from: "user" });
    expect(logs.join("\n")).toContain("Upgrade complete");
    const calls = (spawnImpl as unknown as { mock: { calls: [string, string[]][] } })
      .mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0]?.[1]).toContain("@senecabot/sncb@latest");
  });

  it("rejects on non-zero exit", async () => {
    const spawnImpl = mock(() => makeChild(1)) as unknown as typeof import("node:child_process").spawn;
    const cmd = buildUpgradeCommand({
      currentVersion: "0.1.0",
      fetchImpl: fetchVersion("0.2.0"),
      spawnImpl,
      log: () => undefined,
    });
    cmd.exitOverride();
    await expect(cmd.parseAsync([], { from: "user" })).rejects.toThrow(
      /exited with code 1/,
    );
  });

  it("reports unreachable registry", async () => {
    const fetchImpl = mock(() => Promise.reject(new Error("net")));
    const cmd = buildUpgradeCommand({
      currentVersion: "1.0.0",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: (m) => logs.push(m),
    });
    cmd.exitOverride();
    await cmd.parseAsync([], { from: "user" });
    expect(logs.join("\n")).toContain("Could not reach npm registry");
  });

  it("enables auto-update via --auto-update", async () => {
    const cmd = buildUpgradeCommand({
      currentVersion: "1.0.0",
      fetchImpl: fetchVersion("1.0.0"),
      log: (m) => logs.push(m),
    });
    cmd.exitOverride();
    await cmd.parseAsync(["--auto-update"], { from: "user" });
    const stored = await loadConfig();
    expect(stored.autoUpdate).toBe(true);
    expect(logs.join("\n")).toContain("Auto-update enabled");
  });

  it("disables auto-update via --no-auto-update", async () => {
    const cmd = buildUpgradeCommand({
      currentVersion: "1.0.0",
      fetchImpl: fetchVersion("1.0.0"),
      log: (m) => logs.push(m),
    });
    cmd.exitOverride();
    await cmd.parseAsync(["--no-auto-update", "--check"], { from: "user" });
    const stored = await loadConfig();
    expect(stored.autoUpdate).toBe(false);
  });
});
