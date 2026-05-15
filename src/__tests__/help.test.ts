import { describe, it, expect } from "bun:test";
import { Command } from "commander";
import { renderRootHelp } from "../lib/help.js";

function makeProgram(): Command {
  const p = new Command()
    .name("sncb")
    .version("9.9.9")
    .option("--api-url <url>", "Override API URL")
    .option("-v, --verbose", "Verbose log");
  p.command("auth").description("Authenticate");
  p.command("health").description("Check connection");
  p.command("website").description("Manage websites");
  p.command("page").description("Manage pages");
  p.command("folder").description("Manage folders");
  p.command("agent").description("Manage agents");
  p.command("config").description("Show/set config");
  p.command("audit").description("Audit log");
  p.command("upgrade").description("Self-upgrade");
  return p;
}

describe("renderRootHelp", () => {
  it("includes the sncb banner and version", () => {
    const out = renderRootHelp(makeProgram());
    expect(out).toContain("v9.9.9");
    // banner contains the 'Seneca' ASCII art (one of the recognisable bytes)
    expect(out).toContain("|____/");
  });

  it("groups commands by section (CMS, Agent, Account, Tool)", () => {
    const out = renderRootHelp(makeProgram());
    expect(out).toContain("Account");
    expect(out).toContain("Agent");
    expect(out).toContain("Tool");
  });

  it("lists each registered subcommand by name", () => {
    const out = renderRootHelp(makeProgram());
    for (const name of [
      "auth",
      "health",
      "website",
      "page",
      "folder",
      "agent",
      "config",
      "audit",
      "upgrade",
    ]) {
      expect(out).toContain(name);
    }
  });

  it("lists registered global options", () => {
    const out = renderRootHelp(makeProgram());
    expect(out).toContain("--api-url");
    expect(out).toContain("-v, --verbose");
    expect(out).toContain("-h, --help");
  });

  it("references senecabot.com so users can reach docs", () => {
    const out = renderRootHelp(makeProgram());
    expect(out.toLowerCase()).toContain("senecabot.com");
  });

  it("skips a command group when none of its commands are registered", () => {
    const slim = new Command().name("sncb").version("0.0.1");
    slim.command("auth").description("A");
    // No CMS or Agent commands; only Account.
    const out = renderRootHelp(slim);
    expect(out).toContain("Account");
    expect(out).not.toContain("CMS");
    expect(out).not.toContain("Agent");
  });
});
