import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFolderCommand } from "../commands/folder.js";

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
  tempHome = await mkdtemp(join(tmpdir(), "sncb-folder-"));
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
    return Promise.resolve(new Response(JSON.stringify({ id: "f1" })));
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
  const cmd = buildFolderCommand(() => ({ output: "json" }));
  cmd.exitOverride();
  await cmd.parseAsync(args, { from: "user" });
}

describe("folder list", () => {
  it("GETs folders for website", async () => {    await run(["list", "w1"]);
    expect(captured[0]?.path).toBe("/api/v1/websites/w1/folders");
  });
});

describe("folder get", () => {
  it("GETs by id", async () => {
    await run(["get", "f1"]);
    expect(captured[0]?.path).toBe("/api/v1/folders/f1");
  });
});

describe("folder create", () => {
  it("POSTs with name and null parent", async () => {
    await run(["create", "--website", "w1", "--name", "Docs"]);
    expect(captured[0]?.method).toBe("POST");
    expect(captured[0]?.body).toEqual({ name: "Docs", parent_id: null });
  });

  it("includes parent_id when --parent given", async () => {
    await run(["create", "--website", "w1", "--name", "Sub", "--parent", "p"]);
    expect(captured[0]?.body).toEqual({ name: "Sub", parent_id: "p" });
  });
});

describe("folder update", () => {
  it("PATCHes provided fields", async () => {
    await run(["update", "f1", "--name", "Renamed"]);
    expect(captured[0]?.body).toEqual({ name: "Renamed" });
  });

  it("PATCHes parent_id alone", async () => {
    await run(["update", "f1", "--parent", "p2"]);
    expect(captured[0]?.body).toEqual({ parent_id: "p2" });
  });
});

describe("folder delete", () => {
  it("DELETEs by id", async () => {    await run(["delete", "f1"]);
    expect(captured[0]?.method).toBe("DELETE");
  });
});
