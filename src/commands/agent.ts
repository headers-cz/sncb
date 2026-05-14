import { Command } from "commander";
import { createContext, type GlobalOptions } from "../lib/context.js";
import { render, type Column } from "../output/render.js";
import { readJsonContent } from "../lib/io.js";
import type { Agent } from "../api/types.js";

const AGENT_COLUMNS: Column<Agent>[] = [
  { header: "ID", value: (a) => a.id },
  { header: "NAME", value: (a) => a.name },
  { header: "LANG", value: (a) => a.language },
  { header: "UPDATED", value: (a) => a.updated_at },
];

export function buildAgentCommand(getGlobal: () => GlobalOptions): Command {
  const agent = new Command("agent").description("Read/update agent configuration");

  agent
    .command("get")
    .description("Show agent configuration for the token's organization")
    .action(async () => {
      const ctx = await createContext(getGlobal());
      const item = await ctx.client.request<Agent>("/api/v1/agent");
      console.log(render({ format: ctx.format, data: item, columns: AGENT_COLUMNS }));
    });

  agent
    .command("update")
    .description("Update agent configuration from a JSON file or stdin")
    .option("-f, --file <path>", "JSON file or - for stdin")
    .action(async (opts: { file?: string }) => {
      const ctx = await createContext(getGlobal());
      const body = await readJsonContent<Partial<Agent>>(opts.file);
      const item = await ctx.client.request<Agent>("/api/v1/agent", {
        method: "PATCH",
        body,
      });
      console.log(render({ format: ctx.format, data: item, columns: AGENT_COLUMNS }));
    });

  return agent;
}
