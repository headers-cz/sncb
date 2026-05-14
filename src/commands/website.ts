import { Command } from "commander";
import { createContext, type GlobalOptions } from "../lib/context.js";
import { render, type Column } from "../output/render.js";
import { readJsonContent } from "../lib/io.js";
import type { Website, WebsiteDesign } from "../api/types.js";

const WEBSITE_COLUMNS: Column<Website>[] = [
  { header: "ID", value: (w) => w.id },
  { header: "NAME", value: (w) => w.name },
  { header: "DOMAIN", value: (w) => w.domain ?? "-" },
  { header: "UPDATED", value: (w) => w.updated_at },
];

export function buildWebsiteCommand(getGlobal: () => GlobalOptions): Command {
  const website = new Command("website").description("Manage websites");

  website
    .command("list")
    .description("List websites")
    .action(async () => {
      const ctx = await createContext(getGlobal());
      const items = await ctx.client.request<Website[]>("/api/v1/websites");
      console.log(render({ format: ctx.format, data: items, columns: WEBSITE_COLUMNS }));
    });

  website
    .command("get <id>")
    .description("Show a single website")
    .action(async (id: string) => {
      const ctx = await createContext(getGlobal());
      const item = await ctx.client.request<Website>(`/api/v1/websites/${id}`);
      console.log(render({ format: ctx.format, data: item, columns: WEBSITE_COLUMNS }));
    });

  website
    .command("create")
    .description("Create a website")
    .requiredOption("--name <name>", "Display name")
    .option("--domain <domain>", "Custom domain")
    .action(async (opts: { name: string; domain?: string }) => {
      const ctx = await createContext(getGlobal());
      const item = await ctx.client.request<Website>("/api/v1/websites", {
        method: "POST",
        body: { name: opts.name, domain: opts.domain ?? null },
      });
      console.log(render({ format: ctx.format, data: item, columns: WEBSITE_COLUMNS }));
    });

  website
    .command("update <id>")
    .description("Update a website")
    .option("--name <name>", "New display name")
    .option("--domain <domain>", "New custom domain")
    .action(async (id: string, opts: { name?: string; domain?: string }) => {
      const ctx = await createContext(getGlobal());
      const body: Record<string, unknown> = {};
      if (opts.name !== undefined) body["name"] = opts.name;
      if (opts.domain !== undefined) body["domain"] = opts.domain;
      const item = await ctx.client.request<Website>(`/api/v1/websites/${id}`, {
        method: "PATCH",
        body,
      });
      console.log(render({ format: ctx.format, data: item, columns: WEBSITE_COLUMNS }));
    });

  website
    .command("delete <id>")
    .description("Delete a website")
    .action(async (id: string) => {
      const ctx = await createContext(getGlobal());
      await ctx.client.request<void>(`/api/v1/websites/${id}`, { method: "DELETE" });
      console.log(`Deleted ${id}.`);
    });

  const design = new Command("design").description("Manage website design");
  design
    .command("get <id>")
    .description("Get design")
    .action(async (id: string) => {
      const ctx = await createContext(getGlobal());
      const data = await ctx.client.request<WebsiteDesign>(`/api/v1/websites/${id}/design`);
      console.log(render({ format: ctx.format === "table" ? "json" : ctx.format, data }));
    });
  design
    .command("update <id>")
    .description("Update design (JSON via -f or stdin)")
    .option("-f, --file <path>", "JSON file or - for stdin")
    .action(async (id: string, opts: { file?: string }) => {
      const ctx = await createContext(getGlobal());
      const body = await readJsonContent<WebsiteDesign>(opts.file);
      const data = await ctx.client.request<WebsiteDesign>(
        `/api/v1/websites/${id}/design`,
        { method: "PATCH", body },
      );
      console.log(render({ format: ctx.format === "table" ? "json" : ctx.format, data }));
    });
  website.addCommand(design);

  const domain = new Command("domain").description("Manage website domain");
  domain
    .command("get <id>")
    .description("Get domain")
    .action(async (id: string) => {
      const ctx = await createContext(getGlobal());
      const data = await ctx.client.request<{ domain: string | null }>(
        `/api/v1/websites/${id}/domain`,
      );
      console.log(render({ format: ctx.format === "table" ? "json" : ctx.format, data }));
    });
  domain
    .command("update <id>")
    .description("Update domain")
    .requiredOption("--domain <domain>", "New domain (or empty string to clear)")
    .action(async (id: string, opts: { domain: string }) => {
      const ctx = await createContext(getGlobal());
      const data = await ctx.client.request<{ domain: string | null }>(
        `/api/v1/websites/${id}/domain`,
        { method: "PATCH", body: { domain: opts.domain === "" ? null : opts.domain } },
      );
      console.log(render({ format: ctx.format === "table" ? "json" : ctx.format, data }));
    });
  website.addCommand(domain);

  return website;
}
