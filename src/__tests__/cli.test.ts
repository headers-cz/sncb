import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, buildProgram } from "../cli.js";

let tempHome: string;
let stderr: string;
let origFetch: typeof fetch;
let stderrSpy: ReturnType<typeof spyOn>;

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "sncb-cli-"));
  process.env["XDG_CONFIG_HOME"] = tempHome;
  stderr = "";
  origFetch = globalThis.fetch;
  stderrSpy = spyOn(process.stderr, "write").mockImplementation(
    ((chunk: unknown) => {
      stderr += String(chunk);
      return true;
    }) as typeof process.stderr.write,
  );
});

afterEach(async () => {
  globalThis.fetch = origFetch;
  stderrSpy.mockRestore();
  delete process.env["XDG_CONFIG_HOME"];
  delete process.env["SNCB_TOKEN"];
  delete process.env["SNCB_API_URL"];
  await rm(tempHome, { recursive: true, force: true });
});

describe("buildProgram", () => {
  it("registers all top-level commands", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toEqual(
      expect.arrayContaining(["auth", "health", "website", "page", "agent", "folder"]),
    );
  });

  it("has a version", () => {
    const program = buildProgram();
    expect(program.version()).toMatch(/\d+\.\d+\.\d+/);
  });
});

describe("runCli", () => {
  it("returns 4 when missing auth and using authenticated command", async () => {
    const code = await runCli(["node", "sncb", "health"]);
    expect(code).toBe(4);
    expect(stderr).toMatch(/auth login/);
  });

  it("returns 1 on ApiError 4xx", async () => {
    process.env["SNCB_TOKEN"] = "tok";
    process.env["SNCB_API_URL"] = "https://test";
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "forbidden", message: "Nope" }), {
          status: 403,
        }),
      ),
    ) as unknown as typeof fetch;
    const code = await runCli(["node", "sncb", "health"]);
    expect(code).toBe(1);
    expect(stderr).toContain("forbidden");
  });

  it("returns 3 on NetworkError", async () => {
    process.env["SNCB_TOKEN"] = "tok";
    process.env["SNCB_API_URL"] = "https://test";
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("ECONNREFUSED")),
    ) as unknown as typeof fetch;
    const code = await runCli(["node", "sncb", "health"]);
    expect(code).toBe(3);
    expect(stderr).toMatch(/Network error/);
  });

  it("returns 2 on ApiError 5xx", async () => {
    process.env["SNCB_TOKEN"] = "tok";
    process.env["SNCB_API_URL"] = "https://test";
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "server", message: "boom" }), {
          status: 500,
        }),
      ),
    ) as unknown as typeof fetch;
    const code = await runCli(["node", "sncb", "health"]);
    expect(code).toBe(2);
  });

  it("returns 1 on generic error message", async () => {
    const code = await runCli(["node", "sncb", "--output", "xml", "health"]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/Invalid --output/);
  });
});
