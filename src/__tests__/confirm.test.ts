import { describe, it, expect } from "bun:test";
import { Readable } from "node:stream";
import { confirm, ConfirmationRequiredError } from "../lib/confirm.js";

function fakeTty(input: string): { stdin: Readable & { isTTY?: boolean }; stdout: NodeJS.WritableStream & { isTTY?: boolean }; written: string[] } {
  const stdin = Readable.from([input]) as Readable & { isTTY?: boolean };
  stdin.isTTY = true;
  const written: string[] = [];
  const stdout = {
    isTTY: true,
    write: (chunk: string | Buffer): boolean => {
      written.push(chunk.toString());
      return true;
    },
  } as unknown as NodeJS.WritableStream & { isTTY?: boolean };
  return { stdin, stdout, written };
}

function fakePipe(input: string): { stdin: Readable & { isTTY?: boolean }; stdout: NodeJS.WritableStream & { isTTY?: boolean }; written: string[] } {
  const stdin = Readable.from([input]) as Readable & { isTTY?: boolean };
  stdin.isTTY = false;
  const written: string[] = [];
  const stdout = {
    isTTY: false,
    write: (chunk: string | Buffer): boolean => {
      written.push(chunk.toString());
      return true;
    },
  } as unknown as NodeJS.WritableStream & { isTTY?: boolean };
  return { stdin, stdout, written };
}

describe("confirm", () => {
  it("returns true without prompting when opts.yes is true", async () => {
    const { stdin, stdout, written } = fakeTty("");
    const result = await confirm({
      prompt: "Delete X?",
      yes: true,
      deps: { stdin, stdout },
    });
    expect(result).toBe(true);
    expect(written).toEqual([]);
  });

  it("throws ConfirmationRequiredError in non-TTY without --yes", async () => {
    const { stdin, stdout } = fakePipe("");
    await expect(
      confirm({ prompt: "Delete X?", yes: false, deps: { stdin, stdout } }),
    ).rejects.toBeInstanceOf(ConfirmationRequiredError);
  });

  it("returns true when user types y", async () => {
    const { stdin, stdout, written } = fakeTty("y\n");
    const result = await confirm({
      prompt: "Delete X?",
      yes: false,
      deps: { stdin, stdout },
    });
    expect(result).toBe(true);
    expect(written.join("")).toContain("Delete X?");
    expect(written.join("")).toContain("[y/N]");
  });

  it("returns true when user types YES", async () => {
    const { stdin, stdout } = fakeTty("YES\n");
    expect(
      await confirm({ prompt: "Delete?", yes: false, deps: { stdin, stdout } }),
    ).toBe(true);
  });

  it("returns false when user types n or just presses enter", async () => {
    const { stdin, stdout } = fakeTty("n\n");
    expect(
      await confirm({ prompt: "Delete?", yes: false, deps: { stdin, stdout } }),
    ).toBe(false);

    const empty = fakeTty("\n");
    expect(
      await confirm({ prompt: "Delete?", yes: false, deps: { stdin: empty.stdin, stdout: empty.stdout } }),
    ).toBe(false);
  });
});
