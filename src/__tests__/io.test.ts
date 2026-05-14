import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { readContent, readJsonContent } from "../lib/io.js";

let tempDir: string;
let originalStdin: typeof process.stdin;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "sncb-io-"));
  originalStdin = process.stdin;
});

afterEach(async () => {
  Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
  await rm(tempDir, { recursive: true, force: true });
});

function mockStdin(text: string, isTTY = false): void {
  const stream = Readable.from([text]);
  Object.defineProperty(stream, "isTTY", { value: isTTY, configurable: true });
  Object.defineProperty(process, "stdin", { value: stream, configurable: true });
}

describe("readContent", () => {
  it("reads from file path", async () => {
    const path = join(tempDir, "x.html");
    await writeFile(path, "<p>hi</p>");
    const out = await readContent(path);
    expect(out).toBe("<p>hi</p>");
  });

  it("reads from stdin when file is '-'", async () => {
    mockStdin("stdin body");
    const out = await readContent("-");
    expect(out).toBe("stdin body");
  });

  it("reads from stdin when file undefined and stdin piped", async () => {
    mockStdin("piped");
    const out = await readContent();
    expect(out).toBe("piped");
  });

  it("throws when stdin is a TTY and no file given", async () => {
    mockStdin("", true);
    await expect(readContent()).rejects.toThrow(/stdin/);
  });
});

describe("readJsonContent", () => {
  it("parses JSON content", async () => {
    const path = join(tempDir, "x.json");
    await writeFile(path, JSON.stringify({ a: 1 }));
    const out = await readJsonContent<{ a: number }>(path);
    expect(out).toEqual({ a: 1 });
  });

  it("rethrows on invalid JSON", async () => {
    const path = join(tempDir, "x.json");
    await writeFile(path, "{not json}");
    await expect(readJsonContent(path)).rejects.toThrow(/Invalid JSON/);
  });
});
