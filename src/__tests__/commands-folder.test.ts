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
    if (init.method === "DELETE") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    const path = url.replace("https://test", "");
    const isList = init.method === "GET" && /\/folders$/.test(path);
    const body = isList
      ? { data: [{ id: "f1", title: "Docs", slug: "docs", is_folder: true }] }
      : { data: { id: "f1", title: "Docs", slug: "docs", is_folder: true } };
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
  const cmd = buildFolderCommand(() => ({ output: "json" }));
  cmd.exitOverride();
  await cmd.parseAsync(args, { from: "user" });
}

describe("folder list", () => {
  it("GETs /websites/<id>/folders", async () => {
    await run(["list", "w1"]);
    expect(captured[0]?.path).toBe("/api/v1/websites/w1/folders");
    expect(captured[0]?.method).toBe("GET");
  });
});

describe("folder get", () => {
  it("GETs via /pages/<id> (folders are pages)", async () => {
    await run(["get", "f1"]);
    expect(captured[0]?.path).toBe("/api/v1/pages/f1");
  });
});

describe("folder create", () => {
  it("POSTs title/slug/parentId to /websites/<id>/folders", async () => {
    await run([
      "create",
      "--website", "w1",
      "--title", "Docs",
      "--slug", "docs",
    ]);
    expect(captured[0]?.method).toBe("POST");
    expect(captured[0]?.path).toBe("/api/v1/websites/w1/folders");
    expect(captured[0]?.body).toEqual({
      title: "Docs",
      slug: "docs",
      parentId: null,
    });
  });

  it("includes parentId when --parent given", async () => {
    await run([
      "create",
      "--website", "w1",
      "--title", "Sub",
      "--slug", "sub",
      "--parent", "f1",
    ]);
    expect(captured[0]?.body).toMatchObject({ parentId: "f1" });
  });
});

describe("folder update", () => {
  it("PATCHes via /pages/<id>", async () => {
    await run(["update", "f1", "--title", "Renamed"]);
    expect(captured[0]?.path).toBe("/api/v1/pages/f1");
    expect(captured[0]?.method).toBe("PATCH");
    expect(captured[0]?.body).toEqual({ title: "Renamed" });
  });
});

describe("folder delete", () => {
  it("DELETEs via /pages/<id>", async () => {
    await run(["delete", "f1"]);
    expect(captured[0]?.path).toBe("/api/v1/pages/f1");
    expect(captured[0]?.method).toBe("DELETE");
  });
});
