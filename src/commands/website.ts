import { Command } from "commander";
import { createContext, type GlobalOptions } from "../lib/context.js";
import { render, type Column } from "../output/render.js";
import { readJsonContent } from "../lib/io.js";
import type { Website, WebsiteDesign } from "../api/types.js";

const WEBSITE_COLUMNS: Column<Website>[] = [
  { header: "ID", value: (w) => w.id },
  { header: "NAME", value: (w) => w.name },
  { header: "DOMAIN", value: (w) => w.domain ?? "-" },
  { header: "STATUS", value: (w) => w.status },
  { header: "UPDATED", value: (w) => w.updated_at },
];

export function buildWebsiteCommand(getGlobal: () => GlobalOptions): Command {
  const website = new Command("website").description("Manage websites");

  website
    .command("list")
    .description("List websites in the organization")
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
    .option("--url <url>", "Source URL")
    .action(async (opts: { name: string; url?: string }) => {
      const ctx = await createContext(getGlobal());
      const item = await ctx.client.request<Website>("/api/v1/websites", {
        method: "POST",
        body: { name: opts.name, url: opts.url ?? null },
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
    .command("update <id>")
    .description("Update design scheme and colors")
    .requiredOption("--scheme <scheme>", "Design scheme id (e.g. design-01)")
    .option("--primary <hex>", "Primary color hex (e.g. #283593)")
    .option("--secondary <hex>", "Secondary color hex")
    .action(
      async (
        id: string,
        opts: { scheme: string; primary?: string; secondary?: string },
      ) => {
        const ctx = await createContext(getGlobal());
        const item = await ctx.client.request<WebsiteDesign>(
          `/api/v1/websites/${id}/design`,
          {
            method: "PATCH",
            body: {
              designScheme: opts.scheme,
              primaryColor: opts.primary ?? null,
              secondaryColor: opts.secondary ?? null,
            },
          },
        );
        console.log(JSON.stringify(item, null, 2));
      },
    );
  design
    .command("update-file <id>")
    .description("Update design from a JSON file or stdin")
    .option("-f, --file <path>", "JSON file or - for stdin")
    .action(async (id: string, opts: { file?: string }) => {
      const ctx = await createContext(getGlobal());
      const body = await readJsonContent<{
        designScheme: string;
        primaryColor?: string | null;
        secondaryColor?: string | null;
      }>(opts.file);
      const item = await ctx.client.request<WebsiteDesign>(
        `/api/v1/websites/${id}/design`,
        { method: "PATCH", body },
      );
      console.log(JSON.stringify(item, null, 2));
    });
  website.addCommand(design);

  return website;
}
