import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildHealthCommand } from "../commands/health.js";

let tempHome: string;
let logs: string[];
let origFetch: typeof fetch;
let logSpy: ReturnType<typeof spyOn>;

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "sncb-health-"));
  process.env["XDG_CONFIG_HOME"] = tempHome;
  process.env["SNCB_TOKEN"] = "tok";
  process.env["SNCB_API_URL"] = "https://test";
  logs = [];
  origFetch = globalThis.fetch;
  logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map((a) => String(a)).join(" "));
  });
});

afterEach(async () => {
  globalThis.fetch = origFetch;
  logSpy.mockRestore();
  delete process.env["XDG_CONFIG_HOME"];
  delete process.env["SNCB_TOKEN"];
  delete process.env["SNCB_API_URL"];
  await rm(tempHome, { recursive: true, force: true });
});

describe("health", () => {
  it("GETs /api/v1/health and renders table", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ ok: true, organization_id: "org1", scope: "read" }),
        ),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const cmd = buildHealthCommand(() => ({}));
    cmd.exitOverride();
    await cmd.parseAsync([], { from: "user" });
    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(firstCall[0]).toBe("https://test/api/v1/health");
    expect(logs.join("\n")).toContain("org1");
    expect(logs.join("\n")).toContain("read");
  });

  it("renders JSON with --json via global opts", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, organization_id: "o", scope: "write" })),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const cmd = buildHealthCommand(() => ({ json: true }));
    cmd.exitOverride();
    await cmd.parseAsync([], { from: "user" });
    expect(logs[0]).toContain('"organization_id"');
  });
});
