import { Command } from "commander";
import { createContext, type GlobalOptions } from "../lib/context.js";
import { render, type Column } from "../output/render.js";
import { readJsonContent } from "../lib/io.js";
import type { Agent } from "../api/types.js";

const AGENT_COLUMNS: Column<Agent>[] = [
  { header: "ID", value: (a) => a.id },
  { header: "SLUG", value: (a) => a.slug },
  { header: "COMPANY", value: (a) => a.company_name ?? "-" },
  { header: "LANG", value: (a) => a.language ?? "-" },
  { header: "STATUS", value: (a) => a.status },
];

export function buildAgentCommand(getGlobal: () => GlobalOptions): Command {
  const agent = new Command("agent").description("Read/update agent configuration");

  agent
    .command("list")
    .description("List agents in the token's organization")
    .action(async () => {
      const ctx = await createContext(getGlobal());
      const items = await ctx.client.request<Agent[]>("/api/v1/agents");
      console.log(render({ format: ctx.format, data: items, columns: AGENT_COLUMNS }));
    });

  agent
    .command("get <id>")
    .description("Show a single agent by id")
    .action(async (id: string) => {
      const ctx = await createContext(getGlobal());
      const item = await ctx.client.request<Agent>(`/api/v1/agents/${id}`);
      console.log(render({ format: ctx.format, data: item, columns: AGENT_COLUMNS }));
    });

  agent
    .command("update <id>")
    .description("Update agent configuration from a JSON file or stdin")
    .option("-f, --file <path>", "JSON file or - for stdin")
    .action(async (id: string, opts: { file?: string }) => {
      const ctx = await createContext(getGlobal());
      const body = await readJsonContent<Partial<Agent>>(opts.file);
      const item = await ctx.client.request<Agent>(`/api/v1/agents/${id}`, {
        method: "PATCH",
        body,
      });
      console.log(render({ format: ctx.format, data: item, columns: AGENT_COLUMNS }));
    });

  return agent;
}
