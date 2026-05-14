import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getConfigPaths,
  loadConfig,
  saveConfig,
  clearToken,
} from "../config/storage.js";

let tempHome: string;
let origXdg: string | undefined;

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "sncb-test-"));
  origXdg = process.env["XDG_CONFIG_HOME"];
});

afterEach(async () => {
  if (origXdg === undefined) delete process.env["XDG_CONFIG_HOME"];
  else process.env["XDG_CONFIG_HOME"] = origXdg;
  await rm(tempHome, { recursive: true, force: true });
});

describe("getConfigPaths", () => {
  it("uses XDG_CONFIG_HOME when set", () => {
    process.env["XDG_CONFIG_HOME"] = "/custom/path";
    const paths = getConfigPaths("/home/user");
    expect(paths.dir).toBe("/custom/path/sncb");
    expect(paths.file).toBe("/custom/path/sncb/config.json");
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME absent", () => {
    delete process.env["XDG_CONFIG_HOME"];
    const paths = getConfigPaths("/home/user");
    expect(paths.dir).toBe("/home/user/.config/sncb");
    expect(paths.file).toBe("/home/user/.config/sncb/config.json");
  });
});

describe("loadConfig", () => {
  it("returns defaults when file missing", async () => {
    const paths = { dir: tempHome, file: join(tempHome, "missing.json") };
    const cfg = await loadConfig(paths);
    expect(cfg.apiUrl).toBe("https://app.seneca.headers.cz");
    expect(cfg.token).toBeNull();
    expect(cfg.autoUpdate).toBe(true);
    expect(cfg.lastUpdateCheckAt).toBe(0);
    expect(cfg.lastSeenLatestVersion).toBeNull();
  });

  it("merges stored values onto defaults", async () => {
    const paths = { dir: tempHome, file: join(tempHome, "config.json") };
    await fs.writeFile(paths.file, JSON.stringify({ token: "snc_live_x" }));
    const cfg = await loadConfig(paths);
    expect(cfg.token).toBe("snc_live_x");
    expect(cfg.apiUrl).toBe("https://app.seneca.headers.cz");
  });

  it("respects stored apiUrl", async () => {
    const paths = { dir: tempHome, file: join(tempHome, "config.json") };
    await fs.writeFile(
      paths.file,
      JSON.stringify({ apiUrl: "https://staging.x", token: "t" }),
    );
    const cfg = await loadConfig(paths);
    expect(cfg.apiUrl).toBe("https://staging.x");
  });

  it("rethrows non-ENOENT errors", async () => {
    const paths = { dir: tempHome, file: tempHome };
    await expect(loadConfig(paths)).rejects.toThrow();
  });
});

describe("saveConfig", () => {
  it("writes file with mode 0600", async () => {
    const paths = { dir: tempHome, file: join(tempHome, "config.json") };
    await saveConfig(
      {
        apiUrl: "https://x",
        token: "tok",
        autoUpdate: true,
        lastUpdateCheckAt: 0,
        lastSeenLatestVersion: null,
      },
      paths,
    );
    const stat = await fs.stat(paths.file);
    expect(stat.mode & 0o777).toBe(0o600);
    const parsed = JSON.parse(await fs.readFile(paths.file, "utf-8"));
    expect(parsed.apiUrl).toBe("https://x");
    expect(parsed.token).toBe("tok");
  });

  it("creates parent directory when missing", async () => {
    const paths = {
      dir: join(tempHome, "sub"),
      file: join(tempHome, "sub", "config.json"),
    };
    await saveConfig(
      {
        apiUrl: "https://x",
        token: null,
        autoUpdate: true,
        lastUpdateCheckAt: 0,
        lastSeenLatestVersion: null,
      },
      paths,
    );
    const stat = await fs.stat(paths.file);
    expect(stat.isFile()).toBe(true);
  });
});

describe("clearToken", () => {
  it("nulls token but keeps apiUrl", async () => {
    const paths = { dir: tempHome, file: join(tempHome, "config.json") };
    await saveConfig(
      {
        apiUrl: "https://x",
        token: "tok",
        autoUpdate: true,
        lastUpdateCheckAt: 0,
        lastSeenLatestVersion: null,
      },
      paths,
    );
    await clearToken(paths);
    const cfg = await loadConfig(paths);
    expect(cfg.token).toBeNull();
    expect(cfg.apiUrl).toBe("https://x");
  });
});
