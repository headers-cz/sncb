/**
 * Local audit log for `sncb`.
 *
 * Captures every CLI invocation (intent + HTTP outcome) into a JSON Lines
 * file at $XDG_STATE_HOME/sncb/audit.log (default ~/.local/state/sncb/).
 *
 * The audience is the **operator** who delegated tasks to an AI agent and
 * wants a chronological record of what that agent did on their behalf.
 *
 * Never logs the API token, request bodies, or response bodies.
 *
 * Disable with SNCB_AUDIT=off.
 */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface AuditPaths {
  dir: string;
  file: string;
}

export interface AuditInvocationMeta {
  cmd: string;
  args: string[];
  flags: Record<string, unknown>;
}

export interface AuditHttpInfo {
  method: string;
  path: string;
  apiUrl: string;
  status: number;
  durationMs: number;
}

export type AuditOutcome = "ok" | "error" | "network_error";

export interface AuditEntry {
  ts: string;
  pid: number;
  cmd: string;
  args: string[];
  flags: Record<string, unknown>;
  api_url?: string;
  endpoint?: string;
  status?: number;
  duration_ms?: number;
  outcome: AuditOutcome;
  error_code?: string;
  items_count?: number;
  resource_id?: string;
}

const STATE_DIR_NAME = "sncb";
const AUDIT_FILE = "audit.log";
const SECRET_FLAGS = new Set(["token"]);

export function isAuditEnabled(): boolean {
  const v = (process.env["SNCB_AUDIT"] ?? "").toLowerCase();
  return v !== "off" && v !== "false" && v !== "0";
}

export function getAuditPaths(home: string = homedir()): AuditPaths {
  const base = process.env["XDG_STATE_HOME"] ?? join(home, ".local", "state");
  const dir = join(base, STATE_DIR_NAME);
  return { dir, file: join(dir, AUDIT_FILE) };
}

/**
 * Module-scoped invocation state. The sncb process is single-shot, so this
 * is safe; we never have two parallel invocations within one process.
 */
interface InvocationState {
  startedAt: number;
  meta: AuditInvocationMeta;
  http?: AuditHttpInfo;
  itemsCount?: number;
  resourceId?: string;
}

let currentInvocation: InvocationState | null = null;

export function startInvocation(meta: AuditInvocationMeta): void {
  currentInvocation = {
    startedAt: Date.now(),
    meta: {
      cmd: meta.cmd,
      args: meta.args,
      flags: redactFlags(meta.flags),
    },
  };
}

export function recordHttpCall(info: AuditHttpInfo): void {
  if (currentInvocation === null) return;
  currentInvocation.http = info;
}

export function recordResponseMetadata(meta: {
  itemsCount?: number;
  resourceId?: string;
}): void {
  if (currentInvocation === null) return;
  if (meta.itemsCount !== undefined) currentInvocation.itemsCount = meta.itemsCount;
  if (meta.resourceId !== undefined) currentInvocation.resourceId = meta.resourceId;
}

export async function endInvocation(
  outcome: AuditOutcome,
  errorCode?: string,
  paths: AuditPaths = getAuditPaths(),
): Promise<void> {
  if (!isAuditEnabled()) {
    currentInvocation = null;
    return;
  }
  const inv = currentInvocation;
  currentInvocation = null;
  if (inv === null) return;

  const entry: AuditEntry = {
    ts: new Date().toISOString(),
    pid: process.pid,
    cmd: inv.meta.cmd,
    args: inv.meta.args,
    flags: inv.meta.flags,
    outcome,
  };
  if (inv.http) {
    entry.api_url = inv.http.apiUrl;
    entry.endpoint = `${inv.http.method} ${inv.http.path}`;
    entry.status = inv.http.status;
    entry.duration_ms = inv.http.durationMs;
  } else {
    entry.duration_ms = Date.now() - inv.startedAt;
  }
  if (errorCode !== undefined) entry.error_code = errorCode;
  if (inv.itemsCount !== undefined) entry.items_count = inv.itemsCount;
  if (inv.resourceId !== undefined) entry.resource_id = inv.resourceId;

  await appendEntry(entry, paths);
}

async function appendEntry(entry: AuditEntry, paths: AuditPaths): Promise<void> {
  try {
    await fs.mkdir(dirname(paths.file), { recursive: true });
    await fs.appendFile(paths.file, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // Audit is fire-and-forget. Never break the user's command because we
    // couldn't write the log file.
  }
}

function redactFlags(flags: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flags)) {
    if (SECRET_FLAGS.has(key)) {
      out[key] = "<redacted>";
    } else {
      out[key] = value;
    }
  }
  return out;
}

export async function readAuditEntries(
  paths: AuditPaths = getAuditPaths(),
): Promise<AuditEntry[]> {
  try {
    const text = await fs.readFile(paths.file, "utf-8");
    const out: AuditEntry[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        out.push(JSON.parse(trimmed) as AuditEntry);
      } catch {
        // Skip malformed lines; do not throw.
      }
    }
    return out;
  } catch (err) {
    if (isFsNotFound(err)) return [];
    throw err;
  }
}

export async function clearAuditEntries(
  opts: { olderThan?: Date } = {},
  paths: AuditPaths = getAuditPaths(),
): Promise<{ deleted: number; kept: number }> {
  const entries = await readAuditEntries(paths);
  if (entries.length === 0) return { deleted: 0, kept: 0 };
  if (opts.olderThan === undefined) {
    await fs.rm(paths.file, { force: true });
    return { deleted: entries.length, kept: 0 };
  }
  const cutoff = opts.olderThan.getTime();
  const kept = entries.filter((e) => new Date(e.ts).getTime() >= cutoff);
  const text = kept.map((e) => JSON.stringify(e)).join("\n") + (kept.length > 0 ? "\n" : "");
  await fs.writeFile(paths.file, text, "utf-8");
  return { deleted: entries.length - kept.length, kept: kept.length };
}

function isFsNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "ENOENT";
}
