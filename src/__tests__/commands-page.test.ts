import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPageCommand } from "../commands/page.js";

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
  tempHome = await mkdtemp(join(tmpdir(), "sncb-page-"));
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
    const isList =
      init.method === "GET" &&
      (/\/pages$/.test(path) || /\/versions$/.test(path));
    const body = isList
      ? { data: [{ id: "p1", title: "X", slug: "x" }] }
      : { data: { id: "p1", title: "X", slug: "x" } };
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
  const cmd = buildPageCommand(() => ({ output: "json" }));
  cmd.exitOverride();
  await cmd.parseAsync(args, { from: "user" });
}

describe("page list", () => {
  it("GETs pages for website", async () => {
    await run(["list", "w1"]);
    expect(captured[0]?.path).toBe("/api/v1/websites/w1/pages");
  });
});

describe("page get", () => {
  it("GETs by id", async () => {
    await run(["get", "p1"]);
    expect(captured[0]?.path).toBe("/api/v1/pages/p1");
  });
});

describe("page create", () => {
  it("POSTs with content from file and null parent", async () => {
    const file = join(tempHome, "page.html");
    await writeFile(file, "<p>Hi</p>");
    await run([
      "create", "--website", "w1",
      "--title", "Hello", "--slug", "hi", "-f", file,
    ]);
    expect(captured[0]?.method).toBe("POST");
    expect(captured[0]?.path).toBe("/api/v1/websites/w1/pages");
    expect(captured[0]?.body).toEqual({
      title: "Hello",
      slug: "hi",
      content: "<p>Hi</p>",
      parentId: null,
    });
  });

  it("includes parentId when --parent given", async () => {
    const file = join(tempHome, "page.html");
    await writeFile(file, "<h1>X</h1>");
    await run([
      "create", "--website", "w1",
      "--title", "X", "--slug", "x",
      "--parent", "f1", "-f", file,
    ]);
    expect(captured[0]?.body).toMatchObject({ parentId: "f1" });
  });
});

describe("page update", () => {
  it("PATCHes provided fields", async () => {
    await run(["update", "p1", "--title", "New"]);
    expect(captured[0]?.method).toBe("PATCH");
    expect(captured[0]?.body).toEqual({ title: "New" });
  });

  it("includes content when -f given", async () => {
    const file = join(tempHome, "x.html");
    await writeFile(file, "<p>NEW</p>");
    await run(["update", "p1", "-f", file]);
    expect(captured[0]?.body).toEqual({ content: "<p>NEW</p>" });
  });
});

describe("page delete", () => {
  it("DELETEs by id", async () => {
    await run(["delete", "p1"]);
    expect(captured[0]?.method).toBe("DELETE");
  });
});

describe("page publish / unpublish", () => {
  it("POSTs to /publish", async () => {
    await run(["publish", "p1"]);
    expect(captured[0]?.path).toBe("/api/v1/pages/p1/publish");
    expect(captured[0]?.method).toBe("POST");
  });

  it("POSTs to /unpublish (separate endpoint, not DELETE)", async () => {
    await run(["unpublish", "p1"]);
    expect(captured[0]?.path).toBe("/api/v1/pages/p1/unpublish");
    expect(captured[0]?.method).toBe("POST");
  });
});

describe("page move", () => {
  it("POSTs newParentId", async () => {
    await run(["move", "p1", "--parent", "f2"]);
    expect(captured[0]?.path).toBe("/api/v1/pages/p1/move");
    expect(captured[0]?.body).toEqual({ newParentId: "f2" });
  });

  it("moves to root (null parent) when --parent omitted", async () => {
    await run(["move", "p1"]);
    expect(captured[0]?.body).toEqual({ newParentId: null });
  });
});

describe("page versions", () => {
  it("GETs versions", async () => {
    await run(["versions", "p1"]);
    expect(captured[0]?.path).toBe("/api/v1/pages/p1/versions");
  });
});

describe("page revert", () => {
  it("POSTs to revert endpoint", async () => {
    await run(["revert", "p1", "v1"]);
    expect(captured[0]?.path).toBe("/api/v1/pages/p1/versions/v1/revert");
    expect(captured[0]?.method).toBe("POST");
  });
});
