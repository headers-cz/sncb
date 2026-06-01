import { ApiClient, type RequestLog, type ResponseLog } from "../api/client.js";
import { loadConfig } from "../config/storage.js";
import type { OutputFormat } from "../output/render.js";
import { recordHttpCall } from "./audit.js";
import { stripControl } from "./sanitize.js";
import {
  isInsecureOptIn,
  parseApiUrl,
  TokenHostMismatchError,
} from "./api-url.js";

export interface GlobalOptions {
  apiUrl?: string;
  token?: string;
  output?: string;
  json?: boolean;
  verbose?: boolean;
  insecureAllowTokenHost?: boolean;
}

export interface CommandContext {
  client: ApiClient;
  format: OutputFormat;
}

const TOKEN_ON_ARGV_WARNING =
  "sncb: warning: a token passed via --token is visible in process listings " +
  "(ps) and shell history. Prefer 'sncb auth login' or the SNCB_TOKEN env var.";

/** Warn (once, to stderr) when the secret was supplied on the command line. */
export function warnTokenOnArgv(suppliedOnArgv: boolean): void {
  if (suppliedOnArgv) process.stderr.write(`${TOKEN_ON_ARGV_WARNING}\n`);
}

export async function createContext(global: GlobalOptions): Promise<CommandContext> {
  warnTokenOnArgv(global.token !== undefined);
  const stored = await loadConfig();

  const apiUrlOverridden =
    global.apiUrl !== undefined || process.env["SNCB_API_URL"] !== undefined;
  const apiUrl = global.apiUrl ?? process.env["SNCB_API_URL"] ?? stored.apiUrl;

  const tokenFromStore =
    global.token === undefined && process.env["SNCB_TOKEN"] === undefined;
  const token = global.token ?? process.env["SNCB_TOKEN"] ?? stored.token;

  // 1. Transport: never send the token over plaintext http to a remote host.
  const parsed = parseApiUrl(apiUrl, { allowInsecure: isInsecureOptIn() });

  // 2. Host pinning: a token read from stored config is only sent to the host
  // it was stored for. This blocks token exfiltration via an injected
  // SNCB_API_URL / --api-url pointing the stored credential at another host.
  if (
    tokenFromStore &&
    token !== null &&
    apiUrlOverridden &&
    global.insecureAllowTokenHost !== true
  ) {
    const storedHost = hostOf(stored.apiUrl);
    if (storedHost !== null && storedHost !== parsed.host) {
      throw new TokenHostMismatchError(storedHost, parsed.host);
    }
  }

  const verbose = Boolean(global.verbose);
  return {
    client: new ApiClient({
      apiUrl,
      token,
      onAudit: ({ method, path, status, durationMs }): void => {
        recordHttpCall({ method, path, apiUrl, status, durationMs });
      },
      onRequest: verbose ? logRequest : undefined,
      onResponse: verbose ? logResponse : undefined,
    }),
    format: resolveFormat(global),
  };
}

// Verbose request/response loggers (stderr). The url is server/config-derived,
// so it is stripped of control sequences before printing.
const VERBOSE_TAG = `\x1b[2m[sncb]\x1b[0m`;

function logRequest({ method, url, bodyBytes }: RequestLog): void {
  process.stderr.write(
    `${VERBOSE_TAG} -> ${method} ${stripControl(url)}${bodyBytes ? ` (${bodyBytes}B body)` : ""}\n`,
  );
}

function logResponse({ method, url, status, durationMs }: ResponseLog): void {
  const color = status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : "\x1b[32m";
  process.stderr.write(
    `${VERBOSE_TAG} <- ${color}${status}\x1b[0m ${method} ${stripControl(url)} \x1b[2m(${durationMs}ms)\x1b[0m\n`,
  );
}

function hostOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).host;
  } catch {
    return null;
  }
}

function resolveFormat(global: GlobalOptions): OutputFormat {
  if (global.json) return "json";
  const raw = global.output ?? "table";
  if (raw === "json" || raw === "yaml" || raw === "table") return raw;
  throw new Error(`Invalid --output value: ${raw}. Allowed: table, json, yaml.`);
}
