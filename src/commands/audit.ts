import { Command } from "commander";
import {
  clearAuditEntries,
  getAuditPaths,
  readAuditEntries,
  type AuditEntry,
} from "../lib/audit.js";
import { stripControl } from "../lib/sanitize.js";

const DEFAULT_LAST = 50;

export interface AuditDeps {
  log?: (msg: string) => void;
  err?: (msg: string) => void;
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
  stdout?: NodeJS.WritableStream & { isTTY?: boolean };
}

export function buildAuditCommand(deps: AuditDeps = {}): Command {
  const log = deps.log ?? ((msg: string): void => console.log(msg));
  const err = deps.err ?? ((msg: string): void => {
    process.stderr.write(msg + "\n");
  });

  const audit = new Command("audit").description(
    "Inspect the local audit log of every sncb operation",
  );

  audit
    .command("tail")
    .description("Print the most recent audit entries")
    .option("--last <n>", "Show the last N entries", `${DEFAULT_LAST}`)
    .option("--since <duration>", "Show entries newer than this (e.g. 1h, 24h, 7d)")
    .option("--filter <substring>", "Only show entries whose command contains this substring")
    .option("--json", "Emit raw JSONL instead of the human-readable view", false)
    .action(
      async (opts: {
        last?: string;
        since?: string;
        filter?: string;
        json?: boolean;
      }): Promise<void> => {
        let entries = await readAuditEntries();
        if (opts.since !== undefined) {
          const cutoffMs = parseDurationMs(opts.since);
          const cutoff = Date.now() - cutoffMs;
          entries = entries.filter((e) => new Date(e.ts).getTime() >= cutoff);
        }
        if (opts.filter !== undefined) {
          const f = opts.filter;
          entries = entries.filter((e) => e.cmd.includes(f));
        }
        const last = parsePositiveInt(opts.last ?? `${DEFAULT_LAST}`, "--last");
        const tail = entries.slice(-last);
        if (opts.json) {
          for (const e of tail) log(JSON.stringify(e));
          return;
        }
        if (tail.length === 0) {
          log("No audit entries yet.");
          return;
        }
        for (const line of formatEntries(tail)) log(line);
      },
    );

  audit
    .command("path")
    .description("Print the absolute path of the audit log")
    .action((): void => {
      log(getAuditPaths().file);
    });

  audit
    .command("clear")
    .description("Delete audit entries (all, or older than a duration)")
    .option("--older-than <duration>", "Only delete entries older than this (e.g. 30d, 24h)")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .action(
      async (opts: { olderThan?: string; yes?: boolean }): Promise<void> => {
        const inTty = Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
        if (!opts.yes && inTty) {
          process.stdout.write(
            opts.olderThan !== undefined
              ? `Delete audit entries older than ${opts.olderThan}? [y/N]: `
              : "Delete ALL audit entries? [y/N]: ",
          );
          const ans = await readOneLine(process.stdin);
          if (ans.trim().toLowerCase() !== "y" && ans.trim().toLowerCase() !== "yes") {
            err("Aborted.");
            return;
          }
        } else if (!opts.yes && !inTty) {
          err("refusing to clear audit log in non-interactive mode without --yes");
          process.exitCode = 1;
          return;
        }
        const olderThan =
          opts.olderThan !== undefined
            ? new Date(Date.now() - parseDurationMs(opts.olderThan))
            : undefined;
        const result = await clearAuditEntries(
          olderThan !== undefined ? { olderThan } : {},
        );
        log(`Deleted ${result.deleted} entries (${result.kept} kept).`);
      },
    );

  return audit;
}

function formatEntries(entries: AuditEntry[]): string[] {
  return entries.map((e) => formatEntry(e));
}

function formatEntry(e: AuditEntry): string {
  const ts = e.ts.replace("T", " ").replace(/\.\d+Z$/, "Z");
  const outcomeBadge = badge(e);
  const cmd = `${e.cmd}${formatArgs(e.args)}${formatFlags(e.flags)}`;
  const detail = formatDetail(e);
  // Persisted fields (chiefly error_code) can carry server-controlled escape
  // sequences that round-trip through JSON. Strip them from the human view so
  // `audit tail` cannot be turned into a delayed terminal-injection vector.
  // The --json branch in buildAuditCommand emits raw entries and is untouched.
  return stripControl(`${ts}  ${outcomeBadge}  ${cmd.padEnd(48)}  ${detail}`);
}

function badge(e: AuditEntry): string {
  if (e.outcome === "ok") return "ok  ";
  if (e.outcome === "network_error") return "neterr";
  return `err${e.status !== undefined ? ` ${e.status}` : ""}`.padEnd(6);
}

function formatArgs(args: string[]): string {
  if (args.length === 0) return "";
  return " " + args.map((a) => (a.length > 12 ? `${a.slice(0, 8)}...` : a)).join(" ");
}

function formatFlags(flags: Record<string, unknown>): string {
  const interesting = Object.entries(flags).filter(([k, v]) => v !== false && v !== undefined && k !== "output" && k !== "json" && k !== "verbose");
  if (interesting.length === 0) return "";
  return " " + interesting.map(([k, v]) => (v === true ? `--${k}` : `--${k}=${String(v)}`)).join(" ");
}

function formatDetail(e: AuditEntry): string {
  const parts: string[] = [];
  if (e.items_count !== undefined) parts.push(`${e.items_count} items`);
  if (e.error_code !== undefined) parts.push(e.error_code);
  if (e.duration_ms !== undefined) parts.push(`${e.duration_ms}ms`);
  return parts.join(", ");
}

function parsePositiveInt(raw: string, flagName: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${flagName} must be a positive integer, got ${raw}`);
  }
  return n;
}

function parseDurationMs(raw: string): number {
  const match = /^(\d+)\s*(s|m|h|d)$/.exec(raw.trim());
  if (!match) {
    throw new Error(
      `Invalid duration "${raw}". Use e.g. 30s, 5m, 1h, 7d.`,
    );
  }
  const value = Number.parseInt(match[1] as string, 10);
  const unit = match[2] as string;
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return value * (multipliers[unit] as number);
}

function readOneLine(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    let buffer = "";
    const onData = (chunk: Buffer | string): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      const nl = text.indexOf("\n");
      if (nl === -1) {
        buffer += text;
        return;
      }
      buffer += text.slice(0, nl);
      stream.off("data", onData);
      resolve(buffer);
    };
    stream.on("data", onData);
  });
}
