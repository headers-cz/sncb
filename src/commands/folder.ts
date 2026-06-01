import { Command } from "commander";
import { createContext, type GlobalOptions } from "../lib/context.js";
import { render, type Column } from "../output/render.js";
import type { Page } from "../api/types.js";
import { confirm } from "../lib/confirm.js";
import { recordResponseMetadata } from "../lib/audit.js";
import { stripControl } from "../lib/sanitize.js";

/**
 * Folders in Seneca are pages with `is_folder: true`. The CLI exposes them
 * under a dedicated namespace for convenience, but every command except
 * `list` and `create` operates on /api/v1/pages/<id> directly.
 */

const FOLDER_COLUMNS: Column<Page>[] = [
  { header: "ID", value: (f) => f.id },
  { header: "TITLE", value: (f) => f.title },
  { header: "SLUG", value: (f) => f.slug },
  { header: "PARENT", value: (f) => f.parent_id ?? "-" },
  { header: "UPDATED", value: (f) => f.updated_at },
];

export function buildFolderCommand(getGlobal: () => GlobalOptions): Command {
  const folder = new Command("folder").description(
    "Manage folders (pages with is_folder=true)",
  );

  folder
    .command("list <website-id>")
    .description("List folders in a website")
    .action(async (websiteId: string) => {
      const ctx = await createContext(getGlobal());
      const items = await ctx.client.request<Page[]>(
        `/api/v1/websites/${websiteId}/folders`,
      );
      recordResponseMetadata({ itemsCount: items.length });
      console.log(render({ format: ctx.format, data: items, columns: FOLDER_COLUMNS }));
    });

  folder
    .command("get <id>")
    .description("Show folder details")
    .action(async (id: string) => {
      const ctx = await createContext(getGlobal());
      const item = await ctx.client.request<Page>(`/api/v1/pages/${id}`);
      recordResponseMetadata({ resourceId: item.id });
      console.log(render({ format: ctx.format, data: item, columns: FOLDER_COLUMNS }));
    });

  folder
    .command("create")
    .description("Create a folder")
    .requiredOption("--website <id>", "Parent website id")
    .requiredOption("--title <title>", "Folder title")
    .requiredOption("--slug <slug>", "URL slug (lowercase, hyphens)")
    .option("--parent <id>", "Parent folder id")
    .action(
      async (opts: {
        website: string;
        title: string;
        slug: string;
        parent?: string;
      }) => {
        const ctx = await createContext(getGlobal());
        const item = await ctx.client.request<Page>(
          `/api/v1/websites/${opts.website}/folders`,
          {
            method: "POST",
            body: {
              title: opts.title,
              slug: opts.slug,
              parentId: opts.parent ?? null,
            },
          },
        );
        recordResponseMetadata({ resourceId: item.id });
        console.log(render({ format: ctx.format, data: item, columns: FOLDER_COLUMNS }));
      },
    );

  folder
    .command("update <id>")
    .description("Update a folder's title or slug")
    .option("--title <title>", "New folder title")
    .option("--slug <slug>", "New URL slug")
    .action(async (id: string, opts: { title?: string; slug?: string }) => {
      const ctx = await createContext(getGlobal());
      const body: Record<string, unknown> = {};
      if (opts.title !== undefined) body["title"] = opts.title;
      if (opts.slug !== undefined) body["slug"] = opts.slug;
      const item = await ctx.client.request<Page>(`/api/v1/pages/${id}`, {
        method: "PATCH",
        body,
      });
      recordResponseMetadata({ resourceId: item.id });
      console.log(render({ format: ctx.format, data: item, columns: FOLDER_COLUMNS }));
    });

  folder
    .command("delete <id>")
    .description("Delete a folder (and all pages and folders inside it)")
    .option("-y, --yes", "Skip the confirmation prompt", false)
    .action(async (id: string, opts: { yes: boolean }) => {
      const ctx = await createContext(getGlobal());
      let label = id;
      if (!opts.yes) {
        try {
          const f = await ctx.client.request<Page>(`/api/v1/pages/${id}`);
          label = `'${stripControl(f.title)}' (${f.id})`;
        } catch {
          // fall through
        }
      }
      const proceed = await confirm({
        prompt: `Delete folder ${label}? This removes its children too.`,
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

  return folder;
}
