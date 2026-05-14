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
let stderrSpy: ReturnType<typeof spyOn>;
let metaForPatch: { saved_as: "draft" | "live"; needs_publish: boolean } = { saved_as: "live", needs_publish: false };
let pageGetExtras: Record<string, unknown> = {};

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "sncb-page-"));
  process.env["XDG_CONFIG_HOME"] = tempHome;
  process.env["SNCB_TOKEN"] = "tok";
  process.env["SNCB_API_URL"] = "https://test";
  captured = [];
  origFetch = globalThis.fetch;
  logSpy = spyOn(console, "log").mockImplementation(() => undefined);
  stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
  metaForPatch = { saved_as: "live", needs_publish: false };
  pageGetExtras = {};
  fetchMock = mock((url: string, init: RequestInit) => {
    captured.push({
      path: url.replace("https://test", ""),
      method: init.method,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    if (init.method === "DELETE") {
      const path = url.replace("https://test", "");
      if (path.endsWith("/draft")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: { id: "p1", title: "X", slug: "x", has_draft: false },
            }),
          ),
        );
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    const path = url.replace("https://test", "");
    const isList =
      init.method === "GET" &&
      (/\/pages$/.test(path) || /\/versions$/.test(path));
    const isPagePatch = init.method === "PATCH" && /\/api\/v1\/pages\//.test(path);
    let body: unknown;
    if (isList) {
      body = {
        data: [
          { id: "p1", title: "X", slug: "x", ...pageGetExtras },
        ],
      };
    } else if (isPagePatch) {
      body = { data: { id: "p1", title: "X", slug: "x", ...pageGetExtras }, meta: metaForPatch };
    } else {
      body = { data: { id: "p1", title: "X", slug: "x", ...pageGetExtras } };
    }
    return Promise.resolve(new Response(JSON.stringify(body)));
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = origFetch;
  logSpy.mockRestore();
  stderrSpy.mockRestore();
  delete process.env["XDG_CONFIG_HOME"];
  delete process.env["SNCB_TOKEN"];
  delete process.env["SNCB_API_URL"];
  await rm(tempHome, { recursive: true, force: true });
});

async function run(args: string[], output: string = "json"): Promise<void> {
  const cmd = buildPageCommand(() => ({ output }));
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

  it("prints draft hint to stderr when API reports saved_as=draft (table mode)", async () => {
    metaForPatch = { saved_as: "draft", needs_publish: true };
    await run(["update", "p1", "--title", "New"], "table");
    const wrote = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(wrote).toContain("Saved as draft");
    expect(wrote).toContain("sncb page publish p1");
  });

  it("does not print draft hint when API reports saved_as=live (table mode)", async () => {
    metaForPatch = { saved_as: "live", needs_publish: false };
    await run(["update", "p1", "--title", "New"], "table");
    const wrote = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(wrote).not.toContain("Saved as draft");
  });

  it("does not print hint in json mode (meta already in body)", async () => {
    metaForPatch = { saved_as: "draft", needs_publish: true };
    await run(["update", "p1", "--title", "New"], "json");
    const wrote = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(wrote).not.toContain("Saved as draft");
    const logged = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(logged).toContain('"saved_as": "draft"');
    expect(logged).toContain('"needs_publish": true');
  });

  it("appends ?publish=true to URL when --publish is passed", async () => {
    await run(["update", "p1", "--title", "New", "--publish"]);
    expect(captured[0]?.path).toBe("/api/v1/pages/p1?publish=true");
  });

  it("omits ?publish from URL by default", async () => {
    await run(["update", "p1", "--title", "New"]);
    expect(captured[0]?.path).toBe("/api/v1/pages/p1");
  });
});

describe("page delete", () => {
  it("DELETEs by id when --yes is passed", async () => {
    await run(["delete", "p1", "--yes"]);
    expect(captured[0]?.method).toBe("DELETE");
  });

  it("refuses to DELETE in non-TTY without --yes", async () => {
    await expect(run(["delete", "p1"])).rejects.toThrow(/non-interactive|--yes/);
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

describe("page list DRAFT column", () => {
  it("renders DRAFT yes when has_draft is true", async () => {
    pageGetExtras = { has_draft: true };
    await run(["list", "w1"], "table");
    const out = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(out).toContain("DRAFT");
    expect(out).toContain("yes");
  });
});

describe("page draft ls", () => {
  it("requests pages and filters to ones with a draft", async () => {
    // Override fetch to return a multi-page list mixing has_draft true/false
    globalThis.fetch = (mock(async (_url: string, _init: RequestInit) => {
      return new Response(
        JSON.stringify({
          data: [
            { id: "p1", title: "Has draft", slug: "a", has_draft: true },
            { id: "p2", title: "Clean", slug: "b", has_draft: false },
          ],
        }),
      );
    }) as unknown) as typeof fetch;
    await run(["draft", "ls", "w1"], "table");
    const out = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(out).toContain("Has draft");
    expect(out).not.toContain("Clean");
  });
});

describe("page draft show", () => {
  it("prints stderr hint when page has no draft (table mode)", async () => {
    pageGetExtras = { has_draft: false };
    await run(["draft", "show", "p1"], "table");
    const wrote = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(wrote).toContain("No pending draft");
  });

  it("returns { has_draft: false } in JSON mode when no draft", async () => {
    pageGetExtras = { has_draft: false };
    await run(["draft", "show", "p1"], "json");
    const logged = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(logged).toContain('"has_draft": false');
  });

  it("renders draft content in table mode when draft exists", async () => {
    pageGetExtras = {
      has_draft: true,
      draft_title: "Drafted",
      draft_content: "<p>draft body</p>",
    };
    await run(["draft", "show", "p1"], "table");
    const logged = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(logged).toContain("Drafted");
    expect(logged).toContain("draft body");
  });
});

describe("page draft diff", () => {
  it("emits hunks + stats in JSON mode", async () => {
    pageGetExtras = {
      has_draft: true,
      content: "line1\nline2\nline3",
      draft_content: "line1\nCHANGED\nline3",
      draft_title: null,
    };
    await run(["draft", "diff", "p1"], "json");
    const logged = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    const parsed = JSON.parse(logged) as {
      stats: { added: number; removed: number };
      hunks: Array<{ op: string; line: string }>;
    };
    expect(parsed.stats.added).toBe(1);
    expect(parsed.stats.removed).toBe(1);
    expect(parsed.hunks.some((h) => h.op === "add" && h.line === "CHANGED")).toBe(true);
    expect(parsed.hunks.some((h) => h.op === "remove" && h.line === "line2")).toBe(true);
  });

  it("reports no draft cleanly when has_draft=false", async () => {
    pageGetExtras = { has_draft: false };
    await run(["draft", "diff", "p1"], "table");
    const wrote = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(wrote).toContain("No pending draft");
  });
});

describe("page draft discard", () => {
  it("DELETEs /pages/:id/draft when --yes passed", async () => {
    pageGetExtras = { has_draft: true };
    await run(["draft", "discard", "p1", "--yes"], "table");
    const discardCall = captured.find((c) => c.method === "DELETE" && c.path === "/api/v1/pages/p1/draft");
    expect(discardCall).toBeDefined();
  });

  it("refuses to discard in non-TTY without --yes", async () => {
    pageGetExtras = { has_draft: true };
    await expect(run(["draft", "discard", "p1"], "table")).rejects.toThrow(
      /non-interactive|--yes/,
    );
  });

  it("short-circuits with a hint when page has no draft (no DELETE issued)", async () => {
    pageGetExtras = { has_draft: false };
    await run(["draft", "discard", "p1"], "table");
    expect(captured.some((c) => c.method === "DELETE")).toBe(false);
    const wrote = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(wrote).toContain("Nothing to discard");
  });
});

describe("page draft publish (alias)", () => {
  it("POSTs to /pages/:id/publish (same as `page publish`)", async () => {
    await run(["draft", "publish", "p1"], "table");
    const publishCall = captured.find((c) => c.method === "POST" && c.path === "/api/v1/pages/p1/publish");
    expect(publishCall).toBeDefined();
  });
});
