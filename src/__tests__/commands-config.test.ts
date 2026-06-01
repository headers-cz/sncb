import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildConfigCommand } from "../commands/config.js";
import { saveConfig, type ConfigPaths } from "../config/storage.js";

let tempDir: string;
let paths: ConfigPaths;
let logs: string[];
let log: (msg: string) => void;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "sncb-config-cmd-"));
  paths = { dir: tempDir, file: join(tempDir, "config.json") };
  logs = [];
  log = (msg: string): void => {
    logs.push(msg);
  };
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function run(...argv: string[]): Promise<void> {
  const cmd = buildConfigCommand({ paths, log });
  cmd.exitOverride();
  await cmd.parseAsync(argv, { from: "user" });
}

describe("config get", () => {
  it("prints defaults when no config file exists yet", async () => {
    await run("get");
    const out = JSON.parse(logs[0] ?? "");
    expect(out.apiUrl).toBe("https://app.senecabot.com");
    expect(out.token).toBeNull();
    expect(out.autoUpdate).toBe(true);
  });

  it("masks the token in 'get' output", async () => {
    await saveConfig(
      {
        apiUrl: "https://example.com",
        token: "snc_live_abcdef1234567890",
        autoUpdate: true,
        lastUpdateCheckAt: 0,
        lastSeenLatestVersion: null,
      },
      paths,
    );
    await run("get");
    const out = JSON.parse(logs[0] ?? "");
    expect(out.token).toBe("snc_live...");
    expect(out.token).not.toContain("abcdef");
  });

  it("returns a single value when key is given", async () => {
    await saveConfig(
      {
        apiUrl: "https://example.com",
        token: null,
        autoUpdate: false,
        lastUpdateCheckAt: 0,
        lastSeenLatestVersion: null,
      },
      paths,
    );
    await run("get", "apiUrl");
    expect(logs[0]).toBe("https://example.com");
  });

  it("rejects unknown keys", async () => {
    await expect(run("get", "bogus")).rejects.toThrow(/Unknown config key/);
  });
});

describe("config set", () => {
  it("updates apiUrl and persists to disk", async () => {
    await run("set", "apiUrl", "http://localhost:3002/");
    const raw = await readFile(paths.file, "utf-8");
    const cfg = JSON.parse(raw);
    expect(cfg.apiUrl).toBe("http://localhost:3002");
  });

  it("strips trailing slashes from apiUrl", async () => {
    await run("set", "apiUrl", "https://api.example.com////");
    const cfg = JSON.parse(await readFile(paths.file, "utf-8"));
    expect(cfg.apiUrl).toBe("https://api.example.com");
  });

  it("rejects apiUrl with non-http protocol", async () => {
    await expect(run("set", "apiUrl", "ftp://example.com")).rejects.toThrow(
      /http or https/,
    );
  });

  it("rejects invalid URL", async () => {
    await expect(run("set", "apiUrl", "not-a-url")).rejects.toThrow(/not a valid URL/);
  });

  it("rejects plaintext http to a remote host", async () => {
    await expect(run("set", "apiUrl", "http://api.example.com")).rejects.toThrow(
      /plaintext http/,
    );
  });

  it("still allows http to loopback for local dev", async () => {
    await run("set", "apiUrl", "http://localhost:3002");
    const cfg = JSON.parse(await readFile(paths.file, "utf-8"));
    expect(cfg.apiUrl).toBe("http://localhost:3002");
  });

  it("parses boolean values for autoUpdate", async () => {
    await run("set", "autoUpdate", "false");
    const cfg = JSON.parse(await readFile(paths.file, "utf-8"));
    expect(cfg.autoUpdate).toBe(false);
  });

  it("rejects non-boolean autoUpdate values", async () => {
    await expect(run("set", "autoUpdate", "maybe")).rejects.toThrow(/boolean/);
  });

  it("rejects empty token", async () => {
    await expect(run("set", "token", "")).rejects.toThrow(/cannot be empty/);
  });

  it("stores token verbatim", async () => {
    await run("set", "token", "snc_live_xyz");
    const cfg = JSON.parse(await readFile(paths.file, "utf-8"));
    expect(cfg.token).toBe("snc_live_xyz");
  });

  it("refuses to set read-only / unknown keys", async () => {
    await expect(run("set", "lastUpdateCheckAt", "123")).rejects.toThrow(/Editable keys/);
    await expect(run("set", "totallyBogus", "x")).rejects.toThrow(/Editable keys/);
  });
});

describe("config unset", () => {
  it("resets apiUrl to default", async () => {
    await saveConfig(
      {
        apiUrl: "http://localhost:3002",
        token: null,
        autoUpdate: true,
        lastUpdateCheckAt: 0,
        lastSeenLatestVersion: null,
      },
      paths,
    );
    await run("unset", "apiUrl");
    const cfg = JSON.parse(await readFile(paths.file, "utf-8"));
    expect(cfg.apiUrl).toBe("https://app.senecabot.com");
  });

  it("clears token", async () => {
    await saveConfig(
      {
        apiUrl: "https://app.senecabot.com",
        token: "snc_live_xyz",
        autoUpdate: true,
        lastUpdateCheckAt: 0,
        lastSeenLatestVersion: null,
      },
      paths,
    );
    await run("unset", "token");
    const cfg = JSON.parse(await readFile(paths.file, "utf-8"));
    expect(cfg.token).toBeNull();
  });
});

describe("config path", () => {
  it("prints the config file path", async () => {
    await run("path");
    expect(logs[0]).toBe(paths.file);
  });
});
