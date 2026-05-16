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

let origStdinIsTTY: boolean | undefined;
let origStdoutIsTTY: boolean | undefined;

beforeEach(async () => {
  // Force non-TTY so confirm() refuses interactively-required ops via
  // ConfirmationRequiredError instead of hanging on a y/N prompt when the
  // suite is invoked from a real terminal (e.g. `bun test` locally).
  origStdinIsTTY = (process.stdin as { isTTY?: boolean }).isTTY;
  origStdoutIsTTY = (process.stdout as { isTTY?: boolean }).isTTY;
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
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
    // DELETE -> 204 No Content
    if (init.method === "DELETE") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    // List endpoints: GET on /websites (no id segment after)
    const path = url.replace("https://test", "");
    const isList = init.method === "GET" && /\/api\/v1\/websites$/.test(path);
    const body = isList
      ? { data: [{ id: "w1", name: "X" }] }
      : { data: { id: "w1", name: "X" } };
    return Promise.resolve(new Response(JSON.stringify(body)));
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(async () => {
  Object.defineProperty(process.stdin, "isTTY", { value: origStdinIsTTY, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: origStdoutIsTTY, configurable: true });
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
  it("GETs /api/v1/websites", async () => {
    await run(["list"]);
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
  it("POSTs with name and url", async () => {
    await run(["create", "--name", "X", "--url", "https://x.test"]);
    expect(captured[0]?.path).toBe("/api/v1/websites");
    expect(captured[0]?.method).toBe("POST");
    expect(captured[0]?.body).toEqual({ name: "X", url: "https://x.test" });
  });

  it("sends null url when omitted", async () => {
    await run(["create", "--name", "Y"]);
    expect(captured[0]?.body).toEqual({ name: "Y", url: null });
  });
});

describe("website update", () => {
  it("PATCHes only provided fields", async () => {
    await run(["update", "w1", "--name", "New"]);
    expect(captured[0]?.method).toBe("PATCH");
    expect(captured[0]?.body).toEqual({ name: "New" });
  });

  it("PATCHes domain when --domain is given", async () => {
    await run(["update", "w1", "--domain", "new.test"]);
    expect(captured[0]?.body).toEqual({ domain: "new.test" });
  });
});

describe("website delete", () => {
  it("DELETEs by id and prints confirmation when --yes is passed", async () => {
    await run(["delete", "w1", "--yes"]);
    expect(captured[0]?.method).toBe("DELETE");
    expect(logs.some((l) => l.includes("Deleted w1"))).toBe(true);
  });

  it("refuses to DELETE in non-TTY without --yes", async () => {
    await expect(run(["delete", "w1"])).rejects.toThrow(/non-interactive|--yes/);
    expect(captured.find((c) => c.method === "DELETE")).toBeUndefined();
  });
});

describe("website design", () => {
  it("PATCHes design with explicit scheme and colors", async () => {
    await run([
      "design", "update", "w1",
      "--scheme", "design-01",
      "--primary", "#283593",
      "--secondary", "#4527a0",
    ]);
    expect(captured[0]?.path).toBe("/api/v1/websites/w1/design");
    expect(captured[0]?.method).toBe("PATCH");
    expect(captured[0]?.body).toEqual({
      designScheme: "design-01",
      primaryColor: "#283593",
      secondaryColor: "#4527a0",
    });
  });

  it("PATCHes design from JSON stdin via update-file", async () => {
    const { Readable } = await import("node:stream");
    const stream = Readable.from([
      JSON.stringify({ designScheme: "design-01", primaryColor: "#000" }),
    ]);
    Object.defineProperty(stream, "isTTY", { value: false, configurable: true });
    const orig = process.stdin;
    Object.defineProperty(process, "stdin", { value: stream, configurable: true });
    try {
      await run(["design", "update-file", "w1"]);
    } finally {
      Object.defineProperty(process, "stdin", { value: orig, configurable: true });
    }
    expect(captured[0]?.method).toBe("PATCH");
    expect(captured[0]?.body).toEqual({ designScheme: "design-01", primaryColor: "#000" });
  });
});
