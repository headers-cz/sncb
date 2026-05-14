import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentCommand } from "../commands/agent.js";

interface CapturedRequest {
  path: string;
  method: string | undefined;
  body: unknown;
}

let tempHome: string;
let captured: CapturedRequest[];
let fetchMock: ReturnType<typeof mock>;
let origFetch: typeof fetch;
let logSpy: ReturnType<typeof spyOn>;

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "sncb-agent-"));
  process.env["XDG_CONFIG_HOME"] = tempHome;
  process.env["SNCB_TOKEN"] = "tok";
  process.env["SNCB_API_URL"] = "https://test";
  captured = [];
  origFetch = globalThis.fetch;
  logSpy = spyOn(console, "log").mockImplementation(() => undefined);
  fetchMock = mock((url: string, init: RequestInit) => {
    captured.push({
      path: url.replace("https://test", ""),
      method: init.method,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const path = url.replace("https://test", "");
    const isList = init.method === "GET" && /\/agents$/.test(path);
    const body = isList
      ? { data: [{ id: "a1", slug: "acme", status: "ready" }] }
      : { data: { id: "a1", slug: "acme", status: "ready" } };
    return Promise.resolve(new Response(JSON.stringify(body)));
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
  const cmd = buildAgentCommand(() => ({ output: "json" }));
  cmd.exitOverride();
  await cmd.parseAsync(args, { from: "user" });
}

describe("agent list", () => {
  it("GETs /api/v1/agents", async () => {
    await run(["list"]);
    expect(captured[0]?.path).toBe("/api/v1/agents");
    expect(captured[0]?.method).toBe("GET");
  });
});

describe("agent get", () => {
  it("GETs /api/v1/agents/<id>", async () => {
    await run(["get", "a1"]);
    expect(captured[0]?.path).toBe("/api/v1/agents/a1");
    expect(captured[0]?.method).toBe("GET");
  });
});

describe("agent update", () => {
  it("PATCHes /api/v1/agents/<id> with JSON from file", async () => {
    const file = join(tempHome, "config.json");
    await writeFile(file, JSON.stringify({ company_name: "Bot" }));
    await run(["update", "a1", "-f", file]);
    expect(captured[0]?.path).toBe("/api/v1/agents/a1");
    expect(captured[0]?.method).toBe("PATCH");
    expect(captured[0]?.body).toEqual({ company_name: "Bot" });
  });
});
