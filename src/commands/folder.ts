import { Command } from "commander";
import { createContext, type GlobalOptions } from "../lib/context.js";
import { render, type Column } from "../output/render.js";
import type { Folder } from "../api/types.js";

const FOLDER_COLUMNS: Column<Folder>[] = [
  { header: "ID", value: (f) => f.id },
  { header: "NAME", value: (f) => f.name },
  { header: "PARENT", value: (f) => f.parent_id ?? "-" },
  { header: "UPDATED", value: (f) => f.updated_at },
];

export function buildFolderCommand(getGlobal: () => GlobalOptions): Command {
  const folder = new Command("folder").description("Manage folders");

  folder
    .command("list <website-id>")
    .description("List folders in a website")
    .action(async (websiteId: string) => {
      const ctx = await createContext(getGlobal());
      const items = await ctx.client.request<Folder[]>(
        `/api/v1/websites/${websiteId}/folders`,
      );
      console.log(render({ format: ctx.format, data: items, columns: FOLDER_COLUMNS }));
    });

  folder
    .command("get <id>")
    .description("Show folder details")
    .action(async (id: string) => {
      const ctx = await createContext(getGlobal());
      const item = await ctx.client.request<Folder>(`/api/v1/folders/${id}`);
      console.log(render({ format: ctx.format, data: item, columns: FOLDER_COLUMNS }));
    });

  folder
    .command("create")
    .description("Create a folder")
    .requiredOption("--website <id>", "Parent website id")
    .requiredOption("--name <name>", "Folder name")
    .option("--parent <id>", "Parent folder id")
    .action(async (opts: { website: string; name: string; parent?: string }) => {
      const ctx = await createContext(getGlobal());
      const item = await ctx.client.request<Folder>(
        `/api/v1/websites/${opts.website}/folders`,
        {
          method: "POST",
          body: { name: opts.name, parent_id: opts.parent ?? null },
        },
      );
      console.log(render({ format: ctx.format, data: item, columns: FOLDER_COLUMNS }));
    });

  folder
    .command("update <id>")
    .description("Update a folder")
    .option("--name <name>", "New folder name")
    .option("--parent <id>", "New parent folder id")
    .action(async (id: string, opts: { name?: string; parent?: string }) => {
      const ctx = await createContext(getGlobal());
      const body: Record<string, unknown> = {};
      if (opts.name !== undefined) body["name"] = opts.name;
      if (opts.parent !== undefined) body["parent_id"] = opts.parent;
      const item = await ctx.client.request<Folder>(`/api/v1/folders/${id}`, {
        method: "PATCH",
        body,
      });
      console.log(render({ format: ctx.format, data: item, columns: FOLDER_COLUMNS }));
    });

  folder
    .command("delete <id>")
    .description("Delete a folder")
    .action(async (id: string) => {
      const ctx = await createContext(getGlobal());
      await ctx.client.request<void>(`/api/v1/folders/${id}`, { method: "DELETE" });
      console.log(`Deleted ${id}.`);
    });

  return folder;
}
