import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWebsiteCommand } from "../commands/website.js";

interface CapturedRequest {
  path: string;
  method: string | undefined;
  body: unknown;
}

let tempHome: string;
let logs: string[];
let captured: CapturedRequest[];
let fetchMock: ReturnType<typeof mock>;
let origFetch: typeof fetch;
let logSpy: ReturnType<typeof spyOn>;

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "sncb-cmd-"));
  process.env["XDG_CONFIG_HOME"] = tempHome;
  process.env["SNCB_TOKEN"] = "test-token";
  process.env["SNCB_API_URL"] = "https://test";
  logs = [];
  captured = [];
  origFetch = globalThis.fetch;
  logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map((a) => String(a)).join(" "));
  });
  fetchMock = mock((url: string, init: RequestInit) => {
    captured.push({
      path: url.replace("https://test", ""),
      method: init.method,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    return Promise.resolve(new Response(JSON.stringify({ id: "w1" })));
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = origFetch;
  logSpy.mockRestore();
  delete process.env["XDG_CONFIG_HOME"];
  delete process.env["SNCB_TOKEN"];
  delete process.env["SNCB_API_URL"];
  await rm(tempHome, { recursive: true, force: true });
});

async function run(args: string[]): Promise<void> {
  const cmd = buildWebsiteCommand(() => ({ output: "json" }));
  cmd.exitOverride();
  await cmd.parseAsync(args, { from: "user" });
}

describe("website list", () => {
  it("GETs /api/v1/websites", async () => {    await run(["list"]);
    expect(captured[0]?.path).toBe("/api/v1/websites");
    expect(captured[0]?.method).toBe("GET");
  });
});

describe("website get", () => {
  it("GETs by id", async () => {
    await run(["get", "w1"]);
    expect(captured[0]?.path).toBe("/api/v1/websites/w1");
    expect(captured[0]?.method).toBe("GET");
  });
});

describe("website create", () => {
  it("POSTs with name and domain", async () => {
    await run(["create", "--name", "X", "--domain", "x.test"]);
    expect(captured[0]?.path).toBe("/api/v1/websites");
    expect(captured[0]?.method).toBe("POST");
    expect(captured[0]?.body).toEqual({ name: "X", domain: "x.test" });
  });

  it("sends null domain when omitted", async () => {
    await run(["create", "--name", "Y"]);
    expect(captured[0]?.body).toEqual({ name: "Y", domain: null });
  });
});

describe("website update", () => {
  it("PATCHes only provided fields", async () => {
    await run(["update", "w1", "--name", "New"]);
    expect(captured[0]?.method).toBe("PATCH");
    expect(captured[0]?.body).toEqual({ name: "New" });
  });
});

describe("website delete", () => {
  it("DELETEs by id and prints confirmation", async () => {    await run(["delete", "w1"]);
    expect(captured[0]?.method).toBe("DELETE");
    expect(logs.some((l) => l.includes("Deleted w1"))).toBe(true);
  });
});

describe("website design", () => {
  it("GETs design", async () => {
    await run(["design", "get", "w1"]);
    expect(captured[0]?.path).toBe("/api/v1/websites/w1/design");
  });

  it("PATCHes design from JSON stdin", async () => {
    const { Readable } = await import("node:stream");
    const stream = Readable.from([JSON.stringify({ primary_color: "#000" })]);
    Object.defineProperty(stream, "isTTY", { value: false, configurable: true });
    const orig = process.stdin;
    Object.defineProperty(process, "stdin", { value: stream, configurable: true });
    try {
      await run(["design", "update", "w1"]);
    } finally {
      Object.defineProperty(process, "stdin", { value: orig, configurable: true });
    }
    expect(captured[0]?.method).toBe("PATCH");
    expect(captured[0]?.body).toEqual({ primary_color: "#000" });
  });
});

describe("website domain", () => {
  it("GETs domain", async () => {
    await run(["domain", "get", "w1"]);
    expect(captured[0]?.path).toBe("/api/v1/websites/w1/domain");
  });

  it("PATCHes with new domain", async () => {
    await run(["domain", "update", "w1", "--domain", "new.test"]);
    expect(captured[0]?.body).toEqual({ domain: "new.test" });
  });

  it("PATCHes domain to null when empty string", async () => {
    await run(["domain", "update", "w1", "--domain", ""]);
    expect(captured[0]?.body).toEqual({ domain: null });
  });
});
