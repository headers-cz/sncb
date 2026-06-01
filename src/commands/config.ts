import { Command } from "commander";
import {
  getConfigPaths,
  loadConfig,
  saveConfig,
  type ConfigPaths,
  type SncbConfig,
} from "../config/storage.js";
import { DEFAULT_API_URL, isInsecureOptIn, parseApiUrl } from "../lib/api-url.js";

const EDITABLE_KEYS = ["apiUrl", "token", "autoUpdate"] as const;
type EditableKey = (typeof EDITABLE_KEYS)[number];

const TOKEN_MASK_PREFIX = 8;

export interface ConfigDeps {
  paths?: ConfigPaths;
  log?: (msg: string) => void;
}

export function buildConfigCommand(deps: ConfigDeps = {}): Command {
  const log = deps.log ?? ((msg: string): void => console.log(msg));
  const paths = deps.paths;

  const cmd = new Command("config").description("Read or modify CLI configuration");

  cmd
    .command("get [key]")
    .description("Print all configuration values, or a single value by key")
    .action(async (key?: string): Promise<void> => {
      const cfg = await loadConfig(paths);
      if (key === undefined) {
        const masked: Record<string, unknown> = {
          apiUrl: cfg.apiUrl,
          token: maskToken(cfg.token),
          autoUpdate: cfg.autoUpdate,
          lastUpdateCheckAt: cfg.lastUpdateCheckAt,
          lastSeenLatestVersion: cfg.lastSeenLatestVersion,
        };
        log(JSON.stringify(masked, null, 2));
        return;
      }
      if (!isKnownKey(key)) {
        throw new Error(`Unknown config key: ${key}`);
      }
      const value = cfg[key];
      log(value === null ? "" : String(value));
    });

  cmd
    .command("set <key> <value>")
    .description(`Update a configuration value. Editable keys: ${EDITABLE_KEYS.join(", ")}`)
    .action(async (key: string, value: string): Promise<void> => {
      if (!isEditableKey(key)) {
        throw new Error(
          `Cannot set ${key}. Editable keys: ${EDITABLE_KEYS.join(", ")}`,
        );
      }
      const current = await loadConfig(paths);
      const next = applyValue(current, key, value);
      await saveConfig(next, paths);
      log(`${key} updated.`);
    });

  cmd
    .command("unset <key>")
    .description("Reset an editable key to its default")
    .action(async (key: string): Promise<void> => {
      if (!isEditableKey(key)) {
        throw new Error(
          `Cannot unset ${key}. Editable keys: ${EDITABLE_KEYS.join(", ")}`,
        );
      }
      const current = await loadConfig(paths);
      const next: SncbConfig = { ...current };
      if (key === "apiUrl") next.apiUrl = DEFAULT_API_URL;
      else if (key === "token") next.token = null;
      else next.autoUpdate = true;
      await saveConfig(next, paths);
      log(`${key} reset to default.`);
    });

  cmd
    .command("path")
    .description("Print the absolute path of the config file")
    .action((): void => {
      log((paths ?? getConfigPaths()).file);
    });

  return cmd;
}

function isKnownKey(key: string): key is keyof SncbConfig {
  return (
    key === "apiUrl" ||
    key === "token" ||
    key === "autoUpdate" ||
    key === "lastUpdateCheckAt" ||
    key === "lastSeenLatestVersion"
  );
}

function isEditableKey(key: string): key is EditableKey {
  return (EDITABLE_KEYS as readonly string[]).includes(key);
}

function applyValue(
  current: SncbConfig,
  key: EditableKey,
  raw: string,
): SncbConfig {
  if (key === "apiUrl") {
    return { ...current, apiUrl: normalizeApiUrl(raw) };
  }
  if (key === "token") {
    if (raw.length === 0) throw new Error("Token cannot be empty. Use 'config unset token' instead.");
    return { ...current, token: raw };
  }
  return { ...current, autoUpdate: parseBoolean(raw) };
}

function normalizeApiUrl(raw: string): string {
  // parseApiUrl validates the scheme and rejects plaintext http to a remote
  // host (loopback http stays allowed for local dev; SNCB_INSECURE overrides).
  parseApiUrl(raw, { allowInsecure: isInsecureOptIn() });
  return raw.replace(/\/+$/, "");
}

function parseBoolean(raw: string): boolean {
  const v = raw.toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  throw new Error(`autoUpdate expects a boolean (true|false), got: ${raw}`);
}

function maskToken(token: string | null): string | null {
  if (token === null) return null;
  if (token.length <= TOKEN_MASK_PREFIX) return "***";
  return `${token.slice(0, TOKEN_MASK_PREFIX)}...`;
}
