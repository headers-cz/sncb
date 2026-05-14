import { ApiClient } from "../api/client.js";
import { loadConfig } from "../config/storage.js";
import type { OutputFormat } from "../output/render.js";
import { recordHttpCall } from "./audit.js";

export interface GlobalOptions {
  apiUrl?: string;
  token?: string;
  output?: string;
  json?: boolean;
  verbose?: boolean;
}

export interface CommandContext {
  client: ApiClient;
  format: OutputFormat;
}

export async function createContext(global: GlobalOptions): Promise<CommandContext> {
  const stored = await loadConfig();
  const apiUrl = global.apiUrl ?? process.env["SNCB_API_URL"] ?? stored.apiUrl;
  const token = global.token ?? process.env["SNCB_TOKEN"] ?? stored.token;
  const verbose = Boolean(global.verbose);
  return {
    client: new ApiClient({
      apiUrl,
      token,
      onAudit: ({ method, path, status, durationMs }): void => {
        recordHttpCall({ method, path, apiUrl, status, durationMs });
      },
      onRequest: verbose
        ? ({ method, url, bodyBytes }): void => {
            const tag = `\x1b[2m[sncb]\x1b[0m`;
            process.stderr.write(`${tag} -> ${method} ${url}${bodyBytes ? ` (${bodyBytes}B body)` : ""}\n`);
          }
        : undefined,
      onResponse: verbose
        ? ({ method, url, status, durationMs }): void => {
            const color = status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : "\x1b[32m";
            const tag = `\x1b[2m[sncb]\x1b[0m`;
            process.stderr.write(
              `${tag} <- ${color}${status}\x1b[0m ${method} ${url} \x1b[2m(${durationMs}ms)\x1b[0m\n`,
            );
          }
        : undefined,
    }),
    format: resolveFormat(global),
  };
}

function resolveFormat(global: GlobalOptions): OutputFormat {
  if (global.json) return "json";
  const raw = global.output ?? "table";
  if (raw === "json" || raw === "yaml" || raw === "table") return raw;
  throw new Error(`Invalid --output value: ${raw}. Allowed: table, json, yaml.`);
}
