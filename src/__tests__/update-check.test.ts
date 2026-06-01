import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchLatestVersion,
  runBackgroundUpdateCheck,
} from "../lib/update-check.js";
import { loadConfig, saveConfig, getConfigPaths } from "../config/storage.js";

let tempHome: string;

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "sncb-upd-"));
  process.env["XDG_CONFIG_HOME"] = tempHome;
});

afterEach(async () => {
  delete process.env["XDG_CONFIG_HOME"];
  await rm(tempHome, { recursive: true, force: true });
});

describe("fetchLatestVersion", () => {
  it("returns version string from registry payload", async () => {
    const fetchImpl = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ version: "1.2.3" }))),
    );
    const v = await fetchLatestVersion(fetchImpl as unknown as typeof fetch);
    expect(v).toBe("1.2.3");
  });

  it("returns null on non-200", async () => {
    const fetchImpl = mock(() =>
      Promise.resolve(new Response("err", { status: 500 })),
    );
    const v = await fetchLatestVersion(fetchImpl as unknown as typeof fetch);
    expect(v).toBeNull();
  });

  it("returns null when version field missing", async () => {
    const fetchImpl = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ name: "x" }))),
    );
    const v = await fetchLatestVersion(fetchImpl as unknown as typeof fetch);
    expect(v).toBeNull();
  });

  it("returns null on fetch error", async () => {
    const fetchImpl = mock(() => Promise.reject(new Error("network")));
    const v = await fetchLatestVersion(fetchImpl as unknown as typeof fetch);
    expect(v).toBeNull();
  });
});

describe("runBackgroundUpdateCheck", () => {
  function fakeFetch(latest: string) {
    return mock(() =>
      Promise.resolve(new Response(JSON.stringify({ version: latest }))),
    ) as unknown as typeof fetch;
  }

  it("skips when autoUpdate disabled", async () => {
    await saveConfig(
      {
        apiUrl: "https://x",
        token: null,
        autoUpdate: false,
        lastUpdateCheckAt: 0,
        lastSeenLatestVersion: null,
      },
      getConfigPaths(),
    );
    const notify = mock(() => undefined);
    const res = await runBackgroundUpdateCheck("0.1.0", {
      fetchImpl: fakeFetch("9.9.9"),
      notify,
    });
    expect(res.checked).toBe(false);
    expect(notify.mock.calls.length).toBe(0);
  });

  it("skips when within check interval", async () => {
    const now = Date.now();
    await saveConfig(
      {
        apiUrl: "https://x",
        token: null,
        autoUpdate: true,
        lastUpdateCheckAt: now,
        lastSeenLatestVersion: "0.1.0",
      },
      getConfigPaths(),
    );
    const fetchImpl = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ version: "9.9.9" }))),
    );
    const res = await runBackgroundUpdateCheck("0.1.0", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
      notify: () => undefined,
    });
    expect(res.checked).toBe(false);
    expect(fetchImpl.mock.calls.length).toBe(0);
  });

  it("notifies when newer version available", async () => {
    const notify = mock((_: string) => undefined);
    const res = await runBackgroundUpdateCheck("0.1.0", {
      fetchImpl: fakeFetch("0.2.0"),
      notify,
    });
    expect(res.newer).toBe(true);
    expect(notify.mock.calls.length).toBe(1);
    const stored = await loadConfig();
    expect(stored.lastSeenLatestVersion).toBe("0.2.0");
    expect(stored.lastUpdateCheckAt).toBeGreaterThan(0);
  });

  it("notice tells the user to upgrade manually; never auto-installs", async () => {
    const notify = mock((_: string) => undefined);
    const res = await runBackgroundUpdateCheck("0.1.0", {
      fetchImpl: fakeFetch("0.2.0"),
      notify,
    });
    expect(res.newer).toBe(true);
    expect(String(notify.mock.calls[0]?.[0])).toContain("sncb upgrade");
  });

  it("does not notify when on latest", async () => {
    const notify = mock((_: string) => undefined);
    const res = await runBackgroundUpdateCheck("1.0.0", {
      fetchImpl: fakeFetch("1.0.0"),
      notify,
    });
    expect(res.newer).toBe(false);
    expect(notify.mock.calls.length).toBe(0);
  });

  it("does not notify when registry call returns null", async () => {
    const notify = mock((_: string) => undefined);
    const res = await runBackgroundUpdateCheck("0.1.0", {
      fetchImpl: mock(() =>
        Promise.resolve(new Response("nope", { status: 500 })),
      ) as unknown as typeof fetch,
      notify,
    });
    expect(res.newer).toBe(false);
    expect(notify.mock.calls.length).toBe(0);
  });

  it("rejects a non-semver version string from the registry", async () => {
    const malicious = "9.9.9]0;pwned";
    const v = await fetchLatestVersion(fakeFetch(malicious));
    expect(v).toBeNull();
  });
});
