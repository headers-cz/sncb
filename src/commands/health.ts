import { Command } from "commander";
import { createContext, type GlobalOptions } from "../lib/context.js";
import { render } from "../output/render.js";
import type { Health } from "../api/types.js";

export function buildHealthCommand(getGlobal: () => GlobalOptions): Command {
  return new Command("health").description("Check API health and token").action(async () => {
    const ctx = await createContext(getGlobal());
    const data = await ctx.client.request<Health>("/api/v1/health");
    console.log(
      render({
        format: ctx.format,
        data,
        columns: [
          { header: "OK", value: (h) => String(h.ok) },
          { header: "ORG", value: (h) => h.organization_id },
          { header: "SCOPE", value: (h) => h.scope },
        ],
      }),
    );
  });
}
