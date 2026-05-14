import { ApiClient } from "../api/client.js";
import { loadConfig } from "../config/storage.js";
import type { OutputFormat } from "../output/render.js";

export interface GlobalOptions {
  apiUrl?: string;
  token?: string;
  output?: string;
  json?: boolean;
}

export interface CommandContext {
  client: ApiClient;
  format: OutputFormat;
}

export async function createContext(global: GlobalOptions): Promise<CommandContext> {
  const stored = await loadConfig();
  const apiUrl = global.apiUrl ?? process.env["SNCB_API_URL"] ?? stored.apiUrl;
  const token = global.token ?? process.env["SNCB_TOKEN"] ?? stored.token;
  return {
    client: new ApiClient({ apiUrl, token }),
    format: resolveFormat(global),
  };
}

function resolveFormat(global: GlobalOptions): OutputFormat {
  if (global.json) return "json";
  const raw = global.output ?? "table";
  if (raw === "json" || raw === "yaml" || raw === "table") return raw;
  throw new Error(`Invalid --output value: ${raw}. Allowed: table, json, yaml.`);
}
