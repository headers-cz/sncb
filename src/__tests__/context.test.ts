import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext } from "../lib/context.js";
import { saveConfig, getConfigPaths } from "../config/storage.js";

let tempHome: string;
let origHome: string | undefined;

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "sncb-ctx-"));
  origHome = process.env["XDG_CONFIG_HOME"];
  process.env["XDG_CONFIG_HOME"] = tempHome;
  delete process.env["SNCB_TOKEN"];
  delete process.env["SNCB_API_URL"];
});

afterEach(async () => {
  if (origHome === undefined) delete process.env["XDG_CONFIG_HOME"];
  else process.env["XDG_CONFIG_HOME"] = origHome;
  delete process.env["SNCB_TOKEN"];
  delete process.env["SNCB_API_URL"];
  await rm(tempHome, { recursive: true, force: true });
});

describe("createContext", () => {
  it("defaults format to table", async () => {
    const ctx = await createContext({});
    expect(ctx.format).toBe("table");
  });

  it("uses --json flag", async () => {
    const ctx = await createContext({ json: true });
    expect(ctx.format).toBe("json");
  });

  it("uses --output yaml", async () => {
    const ctx = await createContext({ output: "yaml" });
    expect(ctx.format).toBe("yaml");
  });

  it("uses --output json", async () => {
    const ctx = await createContext({ output: "json" });
    expect(ctx.format).toBe("json");
  });

  it("rejects invalid output", async () => {
    await expect(createContext({ output: "xml" })).rejects.toThrow(/Invalid --output/);
  });

  it("reads token from env when no flag/stored", async () => {
    process.env["SNCB_TOKEN"] = "env-tok";
    const ctx = await createContext({});
    expect(ctx).toBeDefined();
  });

  it("prefers global flag over env", async () => {
    process.env["SNCB_TOKEN"] = "env";
    await saveConfig(
      {
        apiUrl: "https://from-disk",
        token: "disk-tok",
        autoUpdate: true,
        lastUpdateCheckAt: 0,
        lastSeenLatestVersion: null,
      },
      getConfigPaths(),
    );
    const ctx = await createContext({ token: "flag-tok", apiUrl: "https://from-flag" });
    expect(ctx).toBeDefined();
  });

  it("reads apiUrl from stored config", async () => {
    await saveConfig(
      {
        apiUrl: "https://stored.example",
        token: "tok",
        autoUpdate: true,
        lastUpdateCheckAt: 0,
        lastSeenLatestVersion: null,
      },
      getConfigPaths(),
    );
    const ctx = await createContext({});
    expect(ctx).toBeDefined();
  });

  async function storeToken(apiUrl: string): Promise<void> {
    await saveConfig(
      {
        apiUrl,
        token: "snc_live_stored",
        autoUpdate: true,
        lastUpdateCheckAt: 0,
        lastSeenLatestVersion: null,
      },
      getConfigPaths(),
    );
  }

  it("refuses to send a stored token to a different host", async () => {
    await storeToken("https://app.seneca.headers.cz");
    await expect(
      createContext({ apiUrl: "https://evil.tld" }),
    ).rejects.toThrow(/Refusing to send your stored API token/);
  });

  it("refuses a stored token to a host injected via SNCB_API_URL", async () => {
    await storeToken("https://app.seneca.headers.cz");
    process.env["SNCB_API_URL"] = "https://evil.tld";
    await expect(createContext({})).rejects.toThrow(/stored API token/);
  });

  it("allows a different host with --insecure-allow-token-host", async () => {
    await storeToken("https://app.seneca.headers.cz");
    const ctx = await createContext({
      apiUrl: "https://staging.example",
      insecureAllowTokenHost: true,
    });
    expect(ctx).toBeDefined();
  });

  it("allows a different host when the token is supplied explicitly", async () => {
    await storeToken("https://app.seneca.headers.cz");
    const ctx = await createContext({
      apiUrl: "https://staging.example",
      token: "snc_live_explicit",
    });
    expect(ctx).toBeDefined();
  });

  it("rejects plaintext http to a remote host", async () => {
    await expect(
      createContext({ apiUrl: "http://evil.tld", token: "t" }),
    ).rejects.toThrow(/plaintext http/);
  });

  it("allows http to loopback for local dev", async () => {
    const ctx = await createContext({ apiUrl: "http://localhost:3002", token: "t" });
    expect(ctx).toBeDefined();
  });
});
