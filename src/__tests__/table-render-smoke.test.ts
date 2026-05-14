import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWebsiteCommand } from "../commands/website.js";
import { buildPageCommand } from "../commands/page.js";
import { buildFolderCommand } from "../commands/folder.js";
import { buildAgentCommand } from "../commands/agent.js";

let tempHome: string;
let logs: string[];
let origFetch: typeof fetch;
let logSpy: ReturnType<typeof spyOn>;

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "sncb-table-"));
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

function stubFetch(body: unknown): void {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify(body))),
  ) as unknown as typeof fetch;
}

describe("table render smoke", () => {
  it("renders website list in table mode (invokes column callbacks)", async () => {
    stubFetch([
      {
        id: "w1",
        organization_id: "org",
        name: "Web",
        domain: "x.test",
        created_at: "2026-01-01",
        updated_at: "2026-05-14",
      },
    ]);
    const cmd = buildWebsiteCommand(() => ({ output: "table" }));
    cmd.exitOverride();
    await cmd.parseAsync(["list"], { from: "user" });
    expect(logs.some((l) => l.includes("ID"))).toBe(true);
    expect(logs.some((l) => l.includes("Web"))).toBe(true);
  });

  it("renders page list in table mode", async () => {
    stubFetch([
      {
        id: "p1",
        website_id: "w1",
        folder_id: null,
        title: "Hi",
        slug: "hi",
        status: "draft",
        published_at: null,
        created_at: "2026-01-01",
        updated_at: "2026-05-14",
      },
    ]);
    const cmd = buildPageCommand(() => ({ output: "table" }));
    cmd.exitOverride();
    await cmd.parseAsync(["list", "w1"], { from: "user" });
    expect(logs.some((l) => l.includes("Hi"))).toBe(true);
  });

  it("renders page versions in table mode", async () => {
    stubFetch([
      { id: "v1", page_id: "p1", version: 1, created_at: "2026-01-01", created_by: "u1" },
    ]);
    const cmd = buildPageCommand(() => ({ output: "table" }));
    cmd.exitOverride();
    await cmd.parseAsync(["versions", "p1"], { from: "user" });
    expect(logs.some((l) => l.includes("VERSION"))).toBe(true);
  });

  it("renders folder list in table mode", async () => {
    stubFetch([
      {
        id: "f1",
        website_id: "w1",
        name: "Docs",
        parent_id: null,
        created_at: "2026-01-01",
        updated_at: "2026-05-14",
      },
    ]);
    const cmd = buildFolderCommand(() => ({ output: "table" }));
    cmd.exitOverride();
    await cmd.parseAsync(["list", "w1"], { from: "user" });
    expect(logs.some((l) => l.includes("Docs"))).toBe(true);
  });

  it("renders agent get in table mode", async () => {
    stubFetch({
      id: "a1",
      organization_id: "org",
      name: "Bot",
      description: null,
      language: "cs",
      settings: {},
      created_at: "2026-01-01",
      updated_at: "2026-05-14",
    });
    const cmd = buildAgentCommand(() => ({ output: "table" }));
    cmd.exitOverride();
    await cmd.parseAsync(["get"], { from: "user" });
    expect(logs.some((l) => l.includes("Bot"))).toBe(true);
    expect(logs.some((l) => l.includes("cs"))).toBe(true);
  });
});
