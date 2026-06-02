import { loadConfig, saveConfig } from "../config/storage.js";
import { isNewer } from "./version.js";

const PACKAGE_NAME = "@senecabot/sncb";
const REGISTRY_URL = "https://registry.npmjs.org";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const NOTICE_PREFIX = "sncb update:";

// Strict semver: the only shape we accept from the registry. Anything else
// (incl. a version string carrying terminal escape bytes) is rejected, so the
// notice printed to the user can never become an injection vector.
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export interface UpdateCheckDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  notify?: (msg: string) => void;
}

export interface UpdateCheckResult {
  checked: boolean;
  latest: string | null;
  newer: boolean;
}

/**
 * Daily background check that NOTIFIES the user when a newer release exists.
 *
 * It never installs anything. A silent background install would let any
 * higher-versioned publish (npm-account compromise, malicious maintainer, CI
 * token theft) execute on the user's machine without consent. Installing is an
 * explicit, user-invoked action via `sncb upgrade`.
 */
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
  notify(
    `${NOTICE_PREFIX} ${currentVersion} -> ${latest} available. Run 'sncb upgrade' to install.`,
  );
  return { checked: true, latest, newer: true };
}

export async function fetchLatestVersion(
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(
      `${REGISTRY_URL}/${encodePackageName(PACKAGE_NAME)}/latest`,
      {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Accept: "application/json" },
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" && SEMVER_RE.test(body.version)
      ? body.version
      : null;
  } catch {
    return null;
  }
}

function defaultNotify(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

function encodePackageName(name: string): string {
  return name.replace("/", "%2F");
}
