import { Command } from "commander";
import { createContext, type GlobalOptions } from "../lib/context.js";
import { render, type Column } from "../output/render.js";
import { readContent } from "../lib/io.js";
import type { Page, PageVersion } from "../api/types.js";

const PAGE_COLUMNS: Column<Page>[] = [
  { header: "ID", value: (p) => p.id },
  { header: "TITLE", value: (p) => p.title },
  { header: "SLUG", value: (p) => p.slug },
  { header: "STATUS", value: (p) => p.status },
  { header: "FOLDER", value: (p) => p.folder_id ?? "-" },
  { header: "UPDATED", value: (p) => p.updated_at },
];

const VERSION_COLUMNS: Column<PageVersion>[] = [
  { header: "VERSION", value: (v) => String(v.version) },
  { header: "CREATED", value: (v) => v.created_at },
  { header: "BY", value: (v) => v.created_by ?? "-" },
];

export function buildPageCommand(getGlobal: () => GlobalOptions): Command {
  const page = new Command("page").description("Manage pages");

  page
    .command("list <website-id>")
    .description("List pages in a website")
    .action(async (websiteId: string) => {
      const ctx = await createContext(getGlobal());
      const items = await ctx.client.request<Page[]>(
        `/api/v1/websites/${websiteId}/pages`,
      );
      console.log(render({ format: ctx.format, data: items, columns: PAGE_COLUMNS }));
    });

  page
    .command("get <id>")
    .description("Show page metadata")
    .action(async (id: string) => {
      const ctx = await createContext(getGlobal());
      const item = await ctx.client.request<Page>(`/api/v1/pages/${id}`);
      console.log(render({ format: ctx.format, data: item, columns: PAGE_COLUMNS }));
    });

  page
    .command("create")
    .description("Create a page (HTML body via -f or stdin)")
    .requiredOption("--website <id>", "Parent website id")
    .requiredOption("--title <title>", "Page title")
    .requiredOption("--slug <slug>", "URL slug")
    .option("--folder <id>", "Folder id")
    .option("-f, --file <path>", "HTML file or - for stdin")
    .action(
      async (opts: {
        website: string;
        title: string;
        slug: string;
        folder?: string;
        file?: string;
      }) => {
        const ctx = await createContext(getGlobal());
        const content = await readContent(opts.file);
        const item = await ctx.client.request<Page>(
          `/api/v1/websites/${opts.website}/pages`,
          {
            method: "POST",
            body: {
              title: opts.title,
              slug: opts.slug,
              folder_id: opts.folder ?? null,
              content,
            },
          },
        );
        console.log(render({ format: ctx.format, data: item, columns: PAGE_COLUMNS }));
      },
    );

  page
    .command("update <id>")
    .description("Update a page")
    .option("--title <title>")
    .option("--slug <slug>")
    .option("-f, --file <path>", "New HTML body from file or - for stdin")
    .action(
      async (id: string, opts: { title?: string; slug?: string; file?: string }) => {
        const ctx = await createContext(getGlobal());
        const body: Record<string, unknown> = {};
        if (opts.title !== undefined) body["title"] = opts.title;
        if (opts.slug !== undefined) body["slug"] = opts.slug;
        if (opts.file !== undefined) body["content"] = await readContent(opts.file);
        const item = await ctx.client.request<Page>(`/api/v1/pages/${id}`, {
          method: "PATCH",
          body,
        });
        console.log(render({ format: ctx.format, data: item, columns: PAGE_COLUMNS }));
      },
    );

  page
    .command("delete <id>")
    .description("Delete a page")
    .action(async (id: string) => {
      const ctx = await createContext(getGlobal());
      await ctx.client.request<void>(`/api/v1/pages/${id}`, { method: "DELETE" });
      console.log(`Deleted ${id}.`);
    });

  page
    .command("publish <id>")
    .description("Publish a page")
    .action(async (id: string) => {
      const ctx = await createContext(getGlobal());
      const item = await ctx.client.request<Page>(`/api/v1/pages/${id}/publish`, {
        method: "POST",
      });
      console.log(render({ format: ctx.format, data: item, columns: PAGE_COLUMNS }));
    });

  page
    .command("move <id>")
    .description("Move a page to another folder")
    .requiredOption("--folder <id>", "Target folder id (or empty string for root)")
    .action(async (id: string, opts: { folder: string }) => {
      const ctx = await createContext(getGlobal());
      const item = await ctx.client.request<Page>(`/api/v1/pages/${id}/move`, {
        method: "POST",
        body: { folder_id: opts.folder === "" ? null : opts.folder },
      });
      console.log(render({ format: ctx.format, data: item, columns: PAGE_COLUMNS }));
    });

  page
    .command("versions <id>")
    .description("List page versions")
    .action(async (id: string) => {
      const ctx = await createContext(getGlobal());
      const items = await ctx.client.request<PageVersion[]>(
        `/api/v1/pages/${id}/versions`,
      );
      console.log(render({ format: ctx.format, data: items, columns: VERSION_COLUMNS }));
    });

  return page;
}
