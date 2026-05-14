import type { Command } from "commander";

const useColor = process.stdout.isTTY && !process.env["NO_COLOR"];

const ansi = {
  bold: (s: string): string => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string): string => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  cyan: (s: string): string => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
  yellow: (s: string): string => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
};

interface CommandGroup {
  title: string;
  commands: string[];
}

const GROUPS: CommandGroup[] = [
  { title: "Content", commands: ["website", "page", "folder"] },
  { title: "Agent", commands: ["agent"] },
  { title: "Account", commands: ["auth", "health"] },
  { title: "Tool", commands: ["upgrade", "help"] },
];

const COMMAND_COL_WIDTH = 12;
const OPTION_COL_WIDTH = 24;

export function renderRootHelp(program: Command): string {
  const version = program.version() ?? "";
  const subs = new Map(program.commands.map((cmd): [string, Command] => [cmd.name(), cmd]));
  const lines: string[] = [""];

  lines.push(
    `  ${ansi.bold(ansi.yellow("sncb"))} ${ansi.dim(`v${version}`)}  ${ansi.dim("-")}  ${ansi.dim("Seneca REST API CLI")}`,
  );
  lines.push("");
  lines.push("  Manage websites, pages, folders, and agent config from your terminal.");
  lines.push("");

  lines.push(`${ansi.bold("USAGE")}`);
  lines.push(`  ${ansi.cyan("sncb")} ${ansi.dim("[command] [options]")}`);
  lines.push("");

  lines.push(`${ansi.bold("COMMANDS")}`);
  for (const group of GROUPS) {
    const matching = group.commands
      .map((name): Command | undefined => subs.get(name))
      .filter((cmd): cmd is Command => cmd !== undefined);
    if (matching.length === 0) continue;
    lines.push("");
    lines.push(`  ${ansi.dim(group.title)}`);
    for (const cmd of matching) {
      const name = cmd.name().padEnd(COMMAND_COL_WIDTH);
      lines.push(`    ${ansi.cyan(name)}${cmd.description()}`);
    }
  }
  lines.push("");

  lines.push(`${ansi.bold("OPTIONS")}`);
  for (const opt of program.options) {
    const flags = opt.flags.padEnd(OPTION_COL_WIDTH);
    const description = opt.long === "--version" ? "Print version" : opt.description;
    const isPositive = opt.defaultValue !== undefined && opt.defaultValue !== false;
    const def = isPositive
      ? ansi.dim(` (default: ${JSON.stringify(opt.defaultValue)})`)
      : "";
    lines.push(`  ${ansi.cyan(flags)}${description}${def}`);
  }
  lines.push(`  ${ansi.cyan("-h, --help".padEnd(OPTION_COL_WIDTH))}Show this help`);
  lines.push("");

  lines.push(`${ansi.bold("EXAMPLES")}`);
  lines.push(`  ${ansi.dim("# Login and verify connection")}`);
  lines.push("  sncb auth login");
  lines.push("  sncb health");
  lines.push("");
  lines.push(`  ${ansi.dim("# List and create content")}`);
  lines.push("  sncb website list");
  lines.push('  sncb page create --website <id> --title "Hello" --slug hello -f page.html');
  lines.push("");
  lines.push(`  ${ansi.dim("# Scripting (stable JSON output)")}`);
  lines.push("  sncb website list --json | jq '.[].domain'");
  lines.push("");

  lines.push(
    `  ${ansi.dim("Run")} ${ansi.cyan("sncb <command> --help")} ${ansi.dim("for command-specific options.")}`,
  );
  lines.push(`  ${ansi.dim("Docs: https://github.com/headers-cz/sncb")}`);
  lines.push("");

  return lines.join("\n");
}
