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
import { ApiError, AuthRequiredError, NetworkError, exitCodeForError } from "./api/errors.js";
import type { GlobalOptions } from "./lib/context.js";
import { runBackgroundUpdateCheck } from "./lib/update-check.js";
import { renderRootHelp } from "./lib/help.js";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("sncb")
    .description("CLI for the Seneca REST API")
    .version(readVersion())
    .option("--api-url <url>", "Override API base URL")
    .option("--token <token>", "Override API token")
    .option("-o, --output <format>", "Output format: table | json | yaml", "table")
    .option("--json", "Shortcut for --output json", false);

  const getGlobal = (): GlobalOptions => program.opts<GlobalOptions>();

  program.addCommand(buildAuthCommand());
  program.addCommand(buildHealthCommand(getGlobal));
  program.addCommand(buildWebsiteCommand(getGlobal));
  program.addCommand(buildPageCommand(getGlobal));
  program.addCommand(buildAgentCommand(getGlobal));
  program.addCommand(buildFolderCommand(getGlobal));
  program.addCommand(buildUpgradeCommand({ currentVersion: readVersion() }));

  program.helpInformation = (): string => renderRootHelp(program);
  return program;
}

export async function runCli(argv: string[]): Promise<number> {
  const program = buildProgram();
  const invokedCommand = argv[2];
  try {
    await program.parseAsync(argv);
    if (invokedCommand !== "upgrade") {
      await runBackgroundUpdateCheck(readVersion()).catch(() => undefined);
    }
    return 0;
  } catch (err) {
    renderError(err);
    return exitCodeForError(err);
  }
}

function renderError(err: unknown): void {
  if (err instanceof ApiError) {
    process.stderr.write(`API error (${err.status} ${err.code}): ${err.message}\n`);
    return;
  }
  if (err instanceof NetworkError) {
    process.stderr.write(`Network error: ${err.message}\n`);
    return;
  }
  if (err instanceof AuthRequiredError) {
    process.stderr.write(`${err.message}\n`);
    return;
  }
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
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
