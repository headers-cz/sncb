import { spawn } from "node:child_process";
import { loadConfig, saveConfig } from "../config/storage.js";
import { isNewer } from "./version.js";

const PACKAGE_NAME = "@headers/sncb";
const REGISTRY_URL = "https://registry.npmjs.org";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const NOTICE_PREFIX = "sncb update:";

export interface UpdateCheckDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  notify?: (msg: string) => void;
  spawnImpl?: typeof spawn;
  skipBackgroundInstall?: boolean;
}

export interface UpdateCheckResult {
  checked: boolean;
  latest: string | null;
  newer: boolean;
}

export async function runBackgroundUpdateCheck(
  currentVersion: string,
  deps: UpdateCheckDeps = {},
): Promise<UpdateCheckResult> {
  const now = deps.now ?? Date.now;
  const stored = await loadConfig();
  if (!stored.autoUpdate) return { checked: false, latest: null, newer: false };
  if (now() - stored.lastUpdateCheckAt < CHECK_INTERVAL_MS) {
    return { checked: false, latest: stored.lastSeenLatestVersion, newer: false };
  }

  const latest = await fetchLatestVersion(deps.fetchImpl);
  await saveConfig({
    ...stored,
    lastUpdateCheckAt: now(),
    lastSeenLatestVersion: latest ?? stored.lastSeenLatestVersion,
  });
  if (!latest || !isNewer(latest, currentVersion)) {
    return { checked: true, latest, newer: false };
  }

  const notify = deps.notify ?? defaultNotify;
  notify(`${NOTICE_PREFIX} ${currentVersion} -> ${latest} available.`);
  if (!deps.skipBackgroundInstall) {
    triggerBackgroundInstall(deps.spawnImpl);
  }
  return { checked: true, latest, newer: true };
}

export async function fetchLatestVersion(
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchImpl(
        `${REGISTRY_URL}/${encodePackageName(PACKAGE_NAME)}/latest`,
        { signal: controller.signal, headers: { Accept: "application/json" } },
      );
      if (!res.ok) return null;
      const body = (await res.json()) as { version?: unknown };
      return typeof body.version === "string" ? body.version : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

export function triggerBackgroundInstall(spawnImpl: typeof spawn = spawn): void {
  const cmd = detectPackageManager();
  const args = installArgs(cmd);
  const child = spawnImpl(cmd, args, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}

function detectPackageManager(): string {
  const ua = process.env["npm_config_user_agent"] ?? "";
  if (ua.startsWith("bun") || process.env["BUN_INSTALL"]) return "bun";
  if (ua.startsWith("pnpm")) return "pnpm";
  return "npm";
}

function installArgs(cmd: string): string[] {
  if (cmd === "bun") return ["install", "-g", `${PACKAGE_NAME}@latest`];
  if (cmd === "pnpm") return ["add", "-g", `${PACKAGE_NAME}@latest`];
  return ["install", "-g", `${PACKAGE_NAME}@latest`];
}

function defaultNotify(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

function encodePackageName(name: string): string {
  return name.replace("/", "%2F");
}
