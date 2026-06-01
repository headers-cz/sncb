import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { Command } from "commander";
import prompts from "prompts";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAuthCommand } from "../commands/auth.js";
import { loadConfig, saveConfig, getConfigPaths } from "../config/storage.js";

let tempHome: string;
let logs: string[];

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "sncb-auth-"));
  process.env["XDG_CONFIG_HOME"] = tempHome;
  logs = [];
});

afterEach(async () => {
  delete process.env["XDG_CONFIG_HOME"];
  await rm(tempHome, { recursive: true, force: true });
});

function makeClient(health: { organization_id: string; scope: "read" | "write" }) {
  return {
    request: mock(() => Promise.resolve({ ok: true, ...health })) as unknown as <T>(
      path: string,
      opts?: unknown,
    ) => Promise<T>,
  };
}

describe("auth login", () => {
  it("reads the token from the interactive prompt (no --token flag)", async () => {
    const cmd = buildAuthCommand({
      promptToken: mock(() => Promise.resolve("interactive-tok")),
      clientFactory: () => makeClient({ organization_id: "org1", scope: "write" }),
      log: (m) => logs.push(m),
    });
    cmd.exitOverride();
    await cmd.parseAsync(["login"], { from: "user" });
    const cfg = await loadConfig();
    expect(cfg.token).toBe("interactive-tok");
    expect(logs.join("\n")).toContain("org1");
  });

  it("no longer defines a --token option on login", () => {
    const auth = buildAuthCommand();
    const login = auth.commands.find((c) => c.name() === "login");
    const hasTokenOption = (login?.options ?? []).some((o) => o.long === "--token");
    expect(hasTokenOption).toBe(false);
  });

  it("throws when no token provided", async () => {
    const cmd = buildAuthCommand({
      promptToken: mock(() => Promise.resolve("")),
      log: () => undefined,
    });
    cmd.exitOverride();
    await expect(
      cmd.parseAsync(["login"], { from: "user" }),
    ).rejects.toThrow(/Token is required/);
  });

  it("stores --api-url when provided", async () => {
    const cmd = buildAuthCommand({
      promptToken: mock(() => Promise.resolve("prompted-tok")),
      clientFactory: () => makeClient({ organization_id: "o", scope: "read" }),
      log: () => undefined,
    });
    cmd.exitOverride();
    await cmd.parseAsync(["login", "--api-url", "https://staging.x"], { from: "user" });
    const cfg = await loadConfig();
    expect(cfg.apiUrl).toBe("https://staging.x");
  });

  it("picks up --api-url even when a global --api-url on the root shadows it", async () => {
    // Reproduces the real-program collision: the root program defines a global
    // --api-url that shadows the login subcommand's own option. The fix reads
    // optsWithGlobals(), so the value is still applied.
    const root = new Command();
    root.option("--api-url <url>", "global override");
    root.addCommand(
      buildAuthCommand({
        promptToken: mock(() => Promise.resolve("prompted-tok")),
        clientFactory: () => makeClient({ organization_id: "o", scope: "read" }),
        log: () => undefined,
      }),
    );
    root.exitOverride();
    await root.parseAsync(["auth", "login", "--api-url", "https://staging.x"], {
      from: "user",
    });
    const cfg = await loadConfig();
    expect(cfg.apiUrl).toBe("https://staging.x");
  });

  it("writes config file containing the prompted token", async () => {
    const cmd = buildAuthCommand({
      promptToken: mock(() => Promise.resolve("prompted-tok")),
      clientFactory: () => makeClient({ organization_id: "o", scope: "read" }),
      log: () => undefined,
    });
    cmd.exitOverride();
    await cmd.parseAsync(["login"], { from: "user" });
    const paths = getConfigPaths();
    const raw = await readFile(paths.file);
    expect(raw.toString()).toContain('"token": "prompted-tok"');
  });

  it("uses the default interactive prompt when none is injected", async () => {
    prompts.inject(["prompted-by-default"]);
    const cmd = buildAuthCommand({
      clientFactory: () => makeClient({ organization_id: "o", scope: "read" }),
      log: () => undefined,
    });
    cmd.exitOverride();
    await cmd.parseAsync(["login"], { from: "user" });
    const cfg = await loadConfig();
    expect(cfg.token).toBe("prompted-by-default");
  });

  it("uses the default client factory (real ApiClient) when none is injected", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ data: { ok: true, organization_id: "org-real", scope: "read" } }),
        ),
      ),
    ) as unknown as typeof fetch;
    try {
      const cmd = buildAuthCommand({
        promptToken: mock(() => Promise.resolve("prompted-tok")),
        log: (m) => logs.push(m),
      });
      cmd.exitOverride();
      await cmd.parseAsync(["login", "--api-url", "https://test"], { from: "user" });
      const cfg = await loadConfig();
      expect(cfg.token).toBe("prompted-tok");
      expect(logs.join("\n")).toContain("org-real");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("auth logout", () => {
  it("nulls token in stored config", async () => {
    await saveConfig(
      {
        apiUrl: "https://x",
        token: "tok",
        autoUpdate: true,
        lastUpdateCheckAt: 0,
        lastSeenLatestVersion: null,
      },
      getConfigPaths(),
    );
    const cmd = buildAuthCommand({ log: (m) => logs.push(m) });
    cmd.exitOverride();
    await cmd.parseAsync(["logout"], { from: "user" });
    const cfg = await loadConfig();
    expect(cfg.token).toBeNull();
    expect(logs[0]).toMatch(/Logged out/);
  });
});

describe("auth whoami", () => {
  it("requires stored token", async () => {
    const cmd = buildAuthCommand({ log: () => undefined });
    cmd.exitOverride();
    await expect(
      cmd.parseAsync(["whoami"], { from: "user" }),
    ).rejects.toThrow(/Not authenticated/);
  });

  it("prints org and scope when authenticated", async () => {
    await saveConfig(
      {
        apiUrl: "https://x",
        token: "tok",
        autoUpdate: true,
        lastUpdateCheckAt: 0,
        lastSeenLatestVersion: null,
      },
      getConfigPaths(),
    );
    const cmd = buildAuthCommand({
      clientFactory: () => makeClient({ organization_id: "org42", scope: "write" }),
      log: (m) => logs.push(m),
    });
    cmd.exitOverride();
    await cmd.parseAsync(["whoami"], { from: "user" });
    const joined = logs.join("\n");
    expect(joined).toContain("org42");
    expect(joined).toContain("write");
  });
});
