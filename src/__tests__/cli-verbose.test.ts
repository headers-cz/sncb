import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWebsiteCommand } from "../commands/website.js";

let tempHome: string;
let origFetch: typeof fetch;
let stderrSpy: ReturnType<typeof spyOn>;
let stderrOut: string[];

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "sncb-verbose-"));
  process.env["XDG_CONFIG_HOME"] = tempHome;
  process.env["SNCB_TOKEN"] = "tok";
  process.env["SNCB_API_URL"] = "https://test";
  origFetch = globalThis.fetch;
  stderrOut = [];
  stderrSpy = spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderrOut.push(String(chunk));
    return true;
  });
  // Mock console.log too so JSON output doesn't pollute test runner
  spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
  globalThis.fetch = origFetch;
  stderrSpy.mockRestore();
  delete process.env["XDG_CONFIG_HOME"];
  delete process.env["SNCB_TOKEN"];
  delete process.env["SNCB_API_URL"];
  await rm(tempHome, { recursive: true, force: true });
});

function stubFetch(): void {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({ data: [] }))),
  ) as unknown as typeof fetch;
}

describe("verbose flag", () => {
  it("logs request and response lines to stderr when verbose=true", async () => {
    stubFetch();
    const cmd = buildWebsiteCommand(() => ({ output: "json", verbose: true }));
    cmd.exitOverride();
    await cmd.parseAsync(["list"], { from: "user" });
    const text = stderrOut.join("");
    expect(text).toContain("[sncb]");
    expect(text).toContain("-> GET");
    expect(text).toContain("/api/v1/websites");
    expect(text).toMatch(/<- .*200.*GET/);
  });

  it("logs nothing on stderr when verbose=false", async () => {
    stubFetch();
    const cmd = buildWebsiteCommand(() => ({ output: "json", verbose: false }));
    cmd.exitOverride();
    await cmd.parseAsync(["list"], { from: "user" });
    expect(stderrOut.join("")).not.toContain("[sncb]");
  });
});
