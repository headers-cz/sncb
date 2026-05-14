import { Command } from "commander";
import { spawn } from "node:child_process";
import { fetchLatestVersion } from "../lib/update-check.js";
import { isNewer } from "../lib/version.js";
import { loadConfig, saveConfig } from "../config/storage.js";

export interface UpgradeDeps {
  currentVersion: string;
  fetchImpl?: typeof fetch;
  spawnImpl?: typeof spawn;
  log?: (msg: string) => void;
}

export function buildUpgradeCommand(deps: UpgradeDeps): Command {
  const log = deps.log ?? ((msg: string): void => console.log(msg));
  return new Command("upgrade")
    .description("Check for and install the latest sncb release")
    .option("--check", "Only check for a new version, do not install")
    .option("--no-auto-update", "Disable background daily update checks")
    .option("--auto-update", "Enable background daily update checks")
    .action(
      async (opts: { check?: boolean; autoUpdate?: boolean }): Promise<void> => {
        if (opts.autoUpdate !== undefined) {
          const stored = await loadConfig();
          await saveConfig({ ...stored, autoUpdate: opts.autoUpdate });
          log(`Auto-update ${opts.autoUpdate ? "enabled" : "disabled"}.`);
        }
        const latest = await fetchLatestVersion(deps.fetchImpl);
        if (!latest) {
          log("Could not reach npm registry; try again later.");
          return;
        }
        if (!isNewer(latest, deps.currentVersion)) {
          log(`Already on latest version (${deps.currentVersion}).`);
          return;
        }
        log(`New version available: ${deps.currentVersion} -> ${latest}`);
        if (opts.check) return;
        await runInstall(deps.spawnImpl ?? spawn, log);
      },
    );
}

function runInstall(
  spawnImpl: typeof spawn,
  log: (msg: string) => void,
): Promise<void> {
  const cmd = detectPackageManager();
  const args = installArgs(cmd);
  log(`Running: ${cmd} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawnImpl(cmd, args, { stdio: "inherit", env: process.env });
    child.on("exit", (code) => {
      if (code === 0) {
        log("Upgrade complete.");
        resolve();
      } else {
        reject(new Error(`${cmd} exited with code ${code ?? "unknown"}`));
      }
    });
    child.on("error", reject);
  });
}

function detectPackageManager(): string {
  const ua = process.env["npm_config_user_agent"] ?? "";
  if (ua.startsWith("bun") || process.env["BUN_INSTALL"]) return "bun";
  if (ua.startsWith("pnpm")) return "pnpm";
  return "npm";
}

function installArgs(cmd: string): string[] {
  const pkg = "@headers/sncb@latest";
  if (cmd === "bun") return ["install", "-g", pkg];
  if (cmd === "pnpm") return ["add", "-g", pkg];
  return ["install", "-g", pkg];
}
