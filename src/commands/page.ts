import { Command } from "commander";
import { createContext, type GlobalOptions } from "../lib/context.js";
import { render, type Column } from "../output/render.js";
import { readContent } from "../lib/io.js";
import type { Page, PageVersion } from "../api/types.js";
import { confirm } from "../lib/confirm.js";
import { recordResponseMetadata } from "../lib/audit.js";

const PAGE_COLUMNS: Column<Page>[] = [
  { header: "ID", value: (p) => p.id },
  { header: "TITLE", value: (p) => p.title },
  { header: "SLUG", value: (p) => p.slug },
  { header: "PUBLISHED", value: (p) => (p.published ? "yes" : "no") },
  { header: "FOLDER", value: (p) => (p.is_folder ? "yes" : "no") },
  { header: "PARENT", value: (p) => p.parent_id ?? "-" },
  { header: "UPDATED", value: (p) => p.updated_at },
];

const VERSION_COLUMNS: Column<PageVersion>[] = [
  { header: "ID", value: (v) => v.id },
  { header: "TITLE", value: (v) => v.title },
  { header: "USER", value: (v) => v.user_id ?? "-" },
  { header: "CREATED", value: (v) => v.created_at },
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
      recordResponseMetadata({ itemsCount: items.length });
      console.log(render({ format: ctx.format, data: items, columns: PAGE_COLUMNS }));
    });

  page
    .command("get <id>")
    .description("Show page metadata and content")
    .action(async (id: string) => {
      const ctx = await createContext(getGlobal());
      const item = await ctx.client.request<Page>(`/api/v1/pages/${id}`);
      recordResponseMetadata({ resourceId: item.id });
      console.log(render({ format: ctx.format, data: item, columns: PAGE_COLUMNS }));
    });

  page
    .command("create")
    .description("Create a page")
    .requiredOption("--website <id>", "Parent website id")
    .requiredOption("--title <title>", "Page title")
    .requiredOption("--slug <slug>", "URL slug (lowercase, hyphens)")
    .option("--parent <id>", "Parent page id (folder)")
    .option("-f, --file <path>", "Content file (HTML/Markdown) or - for stdin")
    .action(
      async (opts: {
        website: string;
        title: string;
        slug: string;
        parent?: string;
        file?: string;
      }) => {
        const ctx = await createContext(getGlobal());
        const content = opts.file !== undefined ? await readContent(opts.file) : undefined;
        const item = await ctx.client.request<Page>(
          `/api/v1/websites/${opts.website}/pages`,
          {
            method: "POST",
            body: {
              title: opts.title,
              slug: opts.slug,
              content,
              parentId: opts.parent ?? null,
            },
          },
        );
        recordResponseMetadata({ resourceId: item.id });
        console.log(render({ format: ctx.format, data: item, columns: PAGE_COLUMNS }));
      },
    );

  page
    .command("update <id>")
    .description("Update a page (title, slug, or content)")
    .option("--title <title>", "New page title")
    .option("--slug <slug>", "New URL slug")
    .option("-f, --file <path>", "Content file or - for stdin")
    .action(
      async (
        id: string,
        opts: { title?: string; slug?: string; file?: string },
      ) => {
        const ctx = await createContext(getGlobal());
        const body: Record<string, unknown> = {};
        if (opts.title !== undefined) body["title"] = opts.title;
        if (opts.slug !== undefined) body["slug"] = opts.slug;
        if (opts.file !== undefined) body["content"] = await readContent(opts.file);
        const item = await ctx.client.request<Page>(`/api/v1/pages/${id}`, {
          method: "PATCH",
          body,
        });
        recordResponseMetadata({ resourceId: item.id });
        console.log(render({ format: ctx.format, data: item, columns: PAGE_COLUMNS }));
      },
    );

  page
    .command("delete <id>")
    .description("Delete a page")
    .option("-y, --yes", "Skip the confirmation prompt", false)
    .action(async (id: string, opts: { yes: boolean }) => {
      const ctx = await createContext(getGlobal());
      let label = id;
      if (!opts.yes) {
        try {
          const pg = await ctx.client.request<Page>(`/api/v1/pages/${id}`);
          label = `'${pg.title}' (${pg.id})`;
        } catch {
          // fall through to id-only prompt; DELETE will surface real error
        }
      }
      const proceed = await confirm({
        prompt: `Delete page ${label}?`,
        yes: opts.yes,
      });
      if (!proceed) {
        console.log("Aborted.");
        return;
      }
      await ctx.client.request<void>(`/api/v1/pages/${id}`, { method: "DELETE" });
      recordResponseMetadata({ resourceId: id });
      console.log(`Deleted ${id}.`);
    });

  page
    .command("publish <id>")
    .description("Publish a page (make it public)")
    .action(async (id: string) => {
      const ctx = await createContext(getGlobal());
      const item = await ctx.client.request<Page>(`/api/v1/pages/${id}/publish`, {
        method: "POST",
      });
      recordResponseMetadata({ resourceId: item.id });
      console.log(render({ format: ctx.format, data: item, columns: PAGE_COLUMNS }));
    });

  page
    .command("unpublish <id>")
    .description("Unpublish a page (revert to draft)")
    .action(async (id: string) => {
      const ctx = await createContext(getGlobal());
      const item = await ctx.client.request<Page>(`/api/v1/pages/${id}/unpublish`, {
        method: "POST",
      });
      recordResponseMetadata({ resourceId: item.id });
      console.log(render({ format: ctx.format, data: item, columns: PAGE_COLUMNS }));
    });

  page
    .command("move <id>")
    .description("Move a page under a different parent (folder)")
    .option("--parent <id>", "New parent page id (omit to move to root)")
    .action(async (id: string, opts: { parent?: string }) => {
      const ctx = await createContext(getGlobal());
      await ctx.client.request<void>(`/api/v1/pages/${id}/move`, {
        method: "POST",
        body: { newParentId: opts.parent ?? null },
      });
      console.log(`Moved ${id}.`);
    });

  page
    .command("versions <id>")
    .description("List versions of a page")
    .action(async (id: string) => {
      const ctx = await createContext(getGlobal());
      const items = await ctx.client.request<PageVersion[]>(
        `/api/v1/pages/${id}/versions`,
      );
      recordResponseMetadata({ itemsCount: items.length });
      console.log(render({ format: ctx.format, data: items, columns: VERSION_COLUMNS }));
    });

  page
    .command("revert <id> <version-id>")
    .description("Revert a page to a previous version")
    .action(async (id: string, versionId: string) => {
      const ctx = await createContext(getGlobal());
      const item = await ctx.client.request<Page>(
        `/api/v1/pages/${id}/versions/${versionId}/revert`,
        { method: "POST" },
      );
      recordResponseMetadata({ resourceId: item.id });
      console.log(render({ format: ctx.format, data: item, columns: PAGE_COLUMNS }));
    });

  return page;
}
