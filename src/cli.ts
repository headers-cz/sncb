#!/usr/bin/env bun
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildAuthCommand } from "./commands/auth.js";
import { buildHealthCommand } from "./commands/health.js";
import { buildWebsiteCommand } from "./commands/website.js";
import { buildPageCommand } from "./commands/page.js";
import { buildAgentCommand } from "./commands/agent.js";
import { buildFolderCommand } from "./commands/folder.js";
import { buildUpgradeCommand } from "./commands/upgrade.js";
import { buildConfigCommand } from "./commands/config.js";
import { buildAuditCommand } from "./commands/audit.js";
import { ApiError, AuthRequiredError, NetworkError, exitCodeForError } from "./api/errors.js";
import { ConfirmationRequiredError } from "./lib/confirm.js";
import type { GlobalOptions } from "./lib/context.js";
import { runBackgroundUpdateCheck } from "./lib/update-check.js";
import { renderRootHelp } from "./lib/help.js";
import { stripControl } from "./lib/sanitize.js";
import {
  endInvocation,
  startInvocation,
  type AuditOutcome,
} from "./lib/audit.js";

// Error messages can carry server-controlled text (the API error body, or a
// raw non-JSON response). Strip terminal control sequences and cap the length
// before writing to stderr so a hostile server cannot spoof the terminal.
const MAX_ERR_FIELD_LEN = 2000;
function safeErrField(value: string): string {
  const clean = stripControl(value);
  return clean.length > MAX_ERR_FIELD_LEN
    ? `${clean.slice(0, MAX_ERR_FIELD_LEN)}...`
    : clean;
}


export function buildProgram(): Command {
  const program = new Command();
  program
    .name("sncb")
    .description("CLI for the Seneca REST API")
    .version(readVersion())
    .option("--api-url <url>", "Override API base URL")
    .option("--token <token>", "Override API token")
    .option("-o, --output <format>", "Output format: table | json | yaml", "table")
    .option("--json", "Shortcut for --output json", false)
    .option("-v, --verbose", "Log every HTTP request and response to stderr", false)
    .option(
      "--insecure-allow-token-host",
      "Allow sending a stored token to a host other than the one it was stored for",
      false,
    );

  const getGlobal = (): GlobalOptions => program.opts<GlobalOptions>();

  program.addCommand(buildAuthCommand());
  program.addCommand(buildHealthCommand(getGlobal));
  program.addCommand(buildWebsiteCommand(getGlobal));
  program.addCommand(buildPageCommand(getGlobal));
  program.addCommand(buildAgentCommand(getGlobal));
  program.addCommand(buildFolderCommand(getGlobal));
  program.addCommand(buildUpgradeCommand({ currentVersion: readVersion() }));
  program.addCommand(buildConfigCommand());
  program.addCommand(buildAuditCommand());

  program.helpInformation = (): string => renderRootHelp(program);
  return program;
}

export async function runCli(argv: string[]): Promise<number> {
  const program = buildProgram();
  const invokedCommand = argv[2];

  startInvocation({
    cmd: deriveCommandPath(argv),
    args: deriveArgs(argv),
    flags: {},
  });

  let outcome: AuditOutcome = "ok";
  let errorCode: string | undefined;
  try {
    await program.parseAsync(argv);
    if (invokedCommand !== "upgrade") {
      await runBackgroundUpdateCheck(readVersion()).catch(() => undefined);
    }
    await endInvocation(outcome);
    return 0;
  } catch (err) {
    outcome = err instanceof NetworkError ? "network_error" : "error";
    errorCode = inferErrorCode(err);
    await endInvocation(outcome, errorCode);
    renderError(err);
    return exitCodeForError(err);
  }
}

/**
 * Render an error to stderr with an actionable hint when we can infer one.
 */
export function renderError(err: unknown): void {
  if (err instanceof ApiError) {
    process.stderr.write(
      `API error (${err.status} ${safeErrField(err.code)}): ${safeErrField(err.message)}\n`,
    );
    const hint = hintForApiError(err);
    if (hint) process.stderr.write(`  hint: ${hint}\n`);
    return;
  }
  if (err instanceof NetworkError) {
    process.stderr.write(`Network error: ${safeErrField(err.message)}\n`);
    process.stderr.write(
      `  hint: check 'sncb config get apiUrl' and your internet connection\n`,
    );
    return;
  }
  if (err instanceof AuthRequiredError) {
    process.stderr.write(`${safeErrField(err.message)}\n`);
    return;
  }
  if (err instanceof ConfirmationRequiredError) {
    process.stderr.write(`${safeErrField(err.message)}\n`);
    process.stderr.write(`  hint: rerun with --yes to confirm.\n`);
    return;
  }
  process.stderr.write(
    `${safeErrField(err instanceof Error ? err.message : String(err))}\n`,
  );
}

function hintForApiError(err: ApiError): string | null {
  if (err.code === "invalid_token") {
    return "your token is missing or rejected by the server. Run 'sncb auth login' or pass --token.";
  }
  if (err.code === "insufficient_scope") {
    return "this token only has read access. Create a write-scoped token in the Seneca console.";
  }
  if (err.code === "rate_limit_exceeded") {
    const details = err.details as { retry_after_seconds?: unknown } | undefined;
    const retry =
      typeof details?.retry_after_seconds === "number"
        ? details.retry_after_seconds
        : undefined;
    return `rate limit hit${retry ? `. Retry in ${retry}s.` : "."}`;
  }
  if (err.code === "validation_failed") {
    return "the request body failed validation. Run with -v to see the exact payload sent.";
  }
  if (err.status === 404) {
    return "resource not found, or it belongs to a different organization. Verify the id and your token's org.";
  }
  if (err.status === 409) {
    return "the change conflicts with current state (e.g. duplicate slug). Fetch latest and retry.";
  }
  if (err.status >= 500) {
    return "server-side error. Retry after a short delay; if it persists report it with the request id from -v logs.";
  }
  return null;
}

function inferErrorCode(err: unknown): string {
  if (err instanceof ApiError) return err.code;
  if (err instanceof NetworkError) return "network_error";
  if (err instanceof AuthRequiredError) return "not_authenticated";
  if (err instanceof ConfirmationRequiredError) return "confirmation_required";
  return "unknown_error";
}

/**
 * Best-effort reconstruction of the command path from argv, used for the
 * audit log. Walks past global flags. Examples:
 *   ["node","sncb","website","list"]              -> "website list"
 *   ["node","sncb","-v","page","delete","X"]      -> "page delete"
 *   ["node","sncb","--json","audit","tail"]       -> "audit tail"
 */
export function deriveCommandPath(argv: string[]): string {
  const parts: string[] = [];
  let i = 2;
  // Skip global flags
  while (i < argv.length) {
    const token = argv[i] ?? "";
    if (!token.startsWith("-")) break;
    if (
      token === "--api-url" ||
      token === "--token" ||
      token === "--output" ||
      token === "-o"
    ) {
      i += 2;
      continue;
    }
    i += 1;
  }
  // Command + subcommand(s) are non-flag tokens until we hit the first thing
  // that looks like an argument (UUID-like, file path, dash, or another flag).
  while (i < argv.length) {
    const token = argv[i] ?? "";
    if (token.startsWith("-")) break;
    if (looksLikeArgument(token)) break;
    parts.push(token);
    i += 1;
    if (parts.length >= 3) break;
  }
  return parts.join(" ");
}

// Global flags that consume a following value. When we see one in deriveArgs
// we must skip its value too, otherwise a secret like the token (which does
// not start with "-") would be captured into the audit log. deriveCommandPath
// already skips these with `i += 2`.
const VALUE_TAKING_FLAGS = new Set(["--api-url", "--token", "-o", "--output"]);

// Tokens are opaque `snc_live_...` / `snc_test_...` strings. Redact anything
// that looks like one, as a defense-in-depth backstop so a secret can never be
// written to the audit log regardless of how it reached argv.
const TOKEN_LIKE_RE = /^snc_(live|test)_/;

export function deriveArgs(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i] ?? "";
    if (token.startsWith("-")) {
      if (VALUE_TAKING_FLAGS.has(token)) i += 1; // skip the flag's value too
      continue;
    }
    if (out.length === 0 && !looksLikeArgument(token)) continue;
    out.push(TOKEN_LIKE_RE.test(token) ? "<redacted>" : token);
  }
  return out;
}

function looksLikeArgument(token: string): boolean {
  if (token.length > 30) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(token)) return true;
  if (token.includes("/") || token.includes(".")) return true;
  return false;
}


function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf-8")) as {
      version: string;
    };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runCli(process.argv).then((code) => process.exit(code));
}
