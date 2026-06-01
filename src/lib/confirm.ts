/**
 * Interactive confirmation prompt for destructive operations.
 *
 * In a TTY: shows `prompt [y/N]:` and reads the answer.
 * In a non-TTY (pipe, CI, AI agent): refuses with a hint to pass --yes.
 * With opts.yes: returns true without prompting.
 *
 * Why fail in non-TTY: stops AI agents from silently deleting things the
 * operator never intended. The agent must explicitly opt-in via --yes.
 */

import { stripControl } from "./sanitize.js";

export interface ConfirmDeps {
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
  stdout?: NodeJS.WritableStream & { isTTY?: boolean };
}

export class ConfirmationRequiredError extends Error {
  constructor() {
    super(
      "refusing to perform a destructive operation in non-interactive mode without --yes",
    );
    this.name = "ConfirmationRequiredError";
  }
}

export interface ConfirmOptions {
  prompt: string;
  yes: boolean;
  deps?: ConfirmDeps;
}

export async function confirm(options: ConfirmOptions): Promise<boolean> {
  if (options.yes) return true;
  const stdin = options.deps?.stdin ?? process.stdin;
  const stdout = options.deps?.stdout ?? process.stdout;
  const inTty = Boolean(stdin.isTTY) && Boolean(stdout.isTTY);
  if (!inTty) {
    throw new ConfirmationRequiredError();
  }

  // The prompt often embeds server-controlled names/titles. Strip terminal
  // control sequences so a crafted title cannot rewrite this line - the last
  // safety gate before a destructive operation.
  stdout.write(`${stripControl(options.prompt)} [y/N]: `);
  const answer = await readOneLine(stdin);
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

function readOneLine(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    let buffer = "";
    const onData = (chunk: Buffer | string): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      const newlineAt = text.indexOf("\n");
      if (newlineAt === -1) {
        buffer += text;
        return;
      }
      buffer += text.slice(0, newlineAt);
      stream.off("data", onData);
      resolve(buffer);
    };
    stream.on("data", onData);
  });
}
