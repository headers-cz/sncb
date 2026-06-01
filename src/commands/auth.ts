import { Command } from "commander";
import prompts from "prompts";
import { loadConfig, saveConfig, clearToken } from "../config/storage.js";
import { ApiClient } from "../api/client.js";
import type { Health } from "../api/types.js";
import { isInsecureOptIn, parseApiUrl } from "../lib/api-url.js";

export interface AuthDeps {
  promptToken?: () => Promise<string>;
  clientFactory?: (opts: { apiUrl: string; token: string }) => Pick<ApiClient, "request">;
  log?: (msg: string) => void;
}

export function buildAuthCommand(deps: AuthDeps = {}): Command {
  const log = deps.log ?? ((msg: string): void => console.log(msg));
  const auth = new Command("auth").description("Manage Seneca API authentication");

  auth
    .command("login")
    .description("Store API token in ~/.config/sncb/config.json")
    .option("--api-url <url>", "API base URL to store")
    .action(async (opts: { apiUrl?: string }, command: Command) => {
      // The root program's global --api-url shadows this subcommand's option,
      // so read the merged view to get it regardless of where it was parsed.
      const merged = command.optsWithGlobals() as { apiUrl?: string };
      const apiUrlFlag = merged.apiUrl ?? opts.apiUrl;
      // The token is accepted ONLY via the interactive (non-echoing) prompt -
      // never a flag, since argv leaks into `ps` and shell history. Automation
      // sets the SNCB_TOKEN env var per command instead of logging in.
      const token = await (deps.promptToken ?? defaultPromptToken)();
      if (!token) throw new Error("Token is required.");
      const stored = await loadConfig();
      const apiUrl = apiUrlFlag ?? stored.apiUrl;
      // Validate the URL before the health probe sends the token to it: reject
      // bad schemes and plaintext http to a remote host (loopback http is fine
      // for local dev; SNCB_INSECURE overrides).
      parseApiUrl(apiUrl, { allowInsecure: isInsecureOptIn() });
      const client = (deps.clientFactory ?? defaultClientFactory)({ apiUrl, token });
      const health = await client.request<Health>("/api/v1/health");
      await saveConfig({ ...stored, apiUrl, token });
      log(`Logged in to ${apiUrl} (org ${health.organization_id}, scope ${health.scope}).`);
    });

  auth
    .command("logout")
    .description("Remove stored API token")
    .action(async () => {
      await clearToken();
      log("Logged out.");
    });

  auth
    .command("whoami")
    .description("Show active organization and scope")
    .action(async () => {
      const stored = await loadConfig();
      if (!stored.token) throw new Error("Not authenticated. Run `sncb auth login`.");
      const client = (deps.clientFactory ?? defaultClientFactory)({
        apiUrl: stored.apiUrl,
        token: stored.token,
      });
      const health = await client.request<Health>("/api/v1/health");
      log(`API: ${stored.apiUrl}`);
      log(`Organization: ${health.organization_id}`);
      log(`Scope: ${health.scope}`);
    });

  return auth;
}

async function defaultPromptToken(): Promise<string> {
  const res = await prompts({
    type: "password",
    name: "token",
    message: "Paste API token (snc_live_...):",
  });
  return typeof res.token === "string" ? res.token : "";
}

function defaultClientFactory(opts: { apiUrl: string; token: string }): ApiClient {
  return new ApiClient(opts);
}
