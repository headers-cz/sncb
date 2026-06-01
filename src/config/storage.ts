import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_API_URL } from "../lib/api-url.js";

const CONFIG_DIR_NAME = "sncb";
const CONFIG_FILE_NAME = "config.json";
const CONFIG_FILE_MODE = 0o600;
const CONFIG_DIR_MODE = 0o700;

export interface SncbConfig {
  apiUrl: string;
  token: string | null;
  autoUpdate: boolean;
  lastUpdateCheckAt: number;
  lastSeenLatestVersion: string | null;
}

export interface ConfigPaths {
  dir: string;
  file: string;
}

export function getConfigPaths(home: string = homedir()): ConfigPaths {
  const base = process.env["XDG_CONFIG_HOME"] ?? join(home, ".config");
  const dir = join(base, CONFIG_DIR_NAME);
  return { dir, file: join(dir, CONFIG_FILE_NAME) };
}

export async function loadConfig(paths: ConfigPaths = getConfigPaths()): Promise<SncbConfig> {
  try {
    const raw = await fs.readFile(paths.file, "utf-8");
    const parsed = JSON.parse(raw) as Partial<SncbConfig>;
    return {
      apiUrl: parsed.apiUrl ?? DEFAULT_API_URL,
      token: parsed.token ?? null,
      autoUpdate: parsed.autoUpdate ?? true,
      lastUpdateCheckAt: parsed.lastUpdateCheckAt ?? 0,
      lastSeenLatestVersion: parsed.lastSeenLatestVersion ?? null,
    };
  } catch (err) {
    if (isFsNotFound(err)) {
      return {
        apiUrl: DEFAULT_API_URL,
        token: null,
        autoUpdate: true,
        lastUpdateCheckAt: 0,
        lastSeenLatestVersion: null,
      };
    }
    throw err;
  }
}

export async function saveConfig(
  config: SncbConfig,
  paths: ConfigPaths = getConfigPaths(),
): Promise<void> {
  const dir = dirname(paths.file);
  // Keep the directory owner-only too: the token file is 0600, but a
  // world-listable dir still leaks existence/activity timing. Explicit chmods
  // defeat the umask (mkdir/writeFile modes are umask-masked).
  await fs.mkdir(dir, { recursive: true, mode: CONFIG_DIR_MODE });
  await fs.chmod(dir, CONFIG_DIR_MODE);
  const body = JSON.stringify(config, null, 2);
  await fs.writeFile(paths.file, body, { mode: CONFIG_FILE_MODE });
  await fs.chmod(paths.file, CONFIG_FILE_MODE);
}

export async function clearToken(paths: ConfigPaths = getConfigPaths()): Promise<void> {
  const current = await loadConfig(paths);
  await saveConfig({ ...current, token: null }, paths);
}

function isFsNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}
