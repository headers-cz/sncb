import { Command } from "commander";
import { createContext, type GlobalOptions } from "../lib/context.js";
import { render, type Column, type OutputFormat } from "../output/render.js";
import { readContent } from "../lib/io.js";
import type { Page, PageUpdateMeta, PageVersion } from "../api/types.js";
import { confirm } from "../lib/confirm.js";
import { recordResponseMetadata } from "../lib/audit.js";
import { lineDiff, diffStats, renderDiff } from "../lib/diff.js";
import { ansi } from "../lib/ansi.js";

const PAGE_COLUMNS: Column<Page>[] = [
  { header: "ID", value: (p) => p.id },
  { header: "TITLE", value: (p) => p.title },
  { header: "SLUG", value: (p) => p.slug },
  { header: "PUBLISHED", value: (p) => (p.published ? "yes" : "no") },
  { header: "DRAFT", value: (p) => (p.has_draft ? "yes" : "no") },
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

interface DraftFetchResult {
  page: Page;
  hasDraft: boolean;
}

/**
 * Fetch a page and signal absence of a draft cleanly. Returns null when the
 * caller should bail (page has no draft) - in that case the appropriate
 * format-specific notice has already been emitted.
 */
async function fetchPageRequiringDraft(
  client: { request: <T>(p: string) => Promise<T> },
  id: string,
  format: OutputFormat,
  extraStructured: Record<string, unknown> = {},
): Promise<DraftFetchResult | null> {
  const page = await client.request<Page>(`/api/v1/pages/${id}`);
  recordResponseMetadata({ resourceId: page.id });
  if (page.has_draft) return { page, hasDraft: true };
  // For machine-readable formats (json/yaml) emit a structured "no draft"
  // marker so consumers can detect it without parsing stderr. Table mode gets
  // a yellow stderr hint.
  if (format === "json" || format === "yaml") {
    console.log(
      render({ format, data: { has_draft: false, ...extraStructured } }),
    );
  } else {
    process.stderr.write(`${ansi.yellow(`No pending draft for page ${id}.`)}\n`);
  }
  return null;
}

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
    .description("Create a page (optionally publish it in the same call)")
    .requiredOption("--website <id>", "Parent website id")
    .requiredOption("--title <title>", "Page title")
    .requiredOption("--slug <slug>", "URL slug (lowercase, hyphens)")
    .option("--parent <id>", "Parent page id (folder)")
    .option("-f, --file <path>", "Content file (HTML/Markdown) or - for stdin")
    .option(
      "-p, --publish",
      "Publish the page immediately after create",
      false,
    )
    .option(
      "-q, --quiet",
      "Print only the new page id on stdout (scriptable)",
      false,
    )
    .action(
      async (opts: {
        website: string;
        title: string;
        slug: string;
        parent?: string;
        file?: string;
        publish: boolean;
        quiet: boolean;
      }) => {
        const ctx = await createContext(getGlobal());
        const content = opts.file !== undefined ? await readContent(opts.file) : undefined;
        let item = await ctx.client.request<Page>(
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
        if (opts.publish) {
          item = await ctx.client.request<Page>(
            `/api/v1/pages/${item.id}/publish`,
            { method: "POST" },
          );
        }
        recordResponseMetadata({ resourceId: item.id });
        if (opts.quiet) {
          console.log(item.id);
        } else {
          console.log(render({ format: ctx.format, data: item, columns: PAGE_COLUMNS }));
        }
      },
    );

  page
    .command("update <id>")
    .description(
      "Update a page. Saved as draft for published pages unless --publish.",
    )
    .option("--title <title>", "New page title")
    .option("--slug <slug>", "New URL slug")
    .option("-f, --file <path>", "Content file or - for stdin")
    .option("-p, --publish", "Publish the page after updating (one round-trip)")
    .action(
      async (
        id: string,
        opts: { title?: string; slug?: string; file?: string; publish?: boolean },
      ) => {
        const ctx = await createContext(getGlobal());
        const body: Record<string, unknown> = {};
        if (opts.title !== undefined) body["title"] = opts.title;
        if (opts.slug !== undefined) body["slug"] = opts.slug;
        if (opts.file !== undefined) body["content"] = await readContent(opts.file);
        const { data: item, meta } = await ctx.client.requestWithMeta<Page, PageUpdateMeta>(
          `/api/v1/pages/${id}`,
          {
            method: "PATCH",
            body,
            ...(opts.publish ? { query: { publish: "true" } } : {}),
          },
        );
        recordResponseMetadata({
          resourceId: item.id,
          ...(meta?.saved_as !== undefined ? { savedAs: meta.saved_as } : {}),
        });
        const payload = meta ? { ...item, _meta: meta } : item;
        console.log(render({ format: ctx.format, data: payload, columns: PAGE_COLUMNS }));
        if (ctx.format !== "json" && meta?.saved_as === "draft") {
          process.stderr.write(
            `${ansi.yellow(`Saved as draft. Run ${ansi.bold(`sncb page publish ${id}`)} to make it live, or pass --publish next time.`)}\n`,
          );
        }
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

  page
    .command("find")
    .description(
      "Look up a page by slug within a website. Useful when you know the " +
      "URL slug but not the UUID. Returns the same shape as `page get`.",
    )
    .requiredOption("--website <id>", "Website id to search in")
    .requiredOption("--slug <slug>", "Page slug to match")
    .option(
      "-q, --quiet",
      "Print only the matching page id on stdout (scriptable)",
      false,
    )
    .action(async (opts: { website: string; slug: string; quiet: boolean }) => {
      const ctx = await createContext(getGlobal());
      const pages = await ctx.client.request<Page[]>(
        `/api/v1/websites/${opts.website}/pages`,
      );
      const hit = pages.find((p) => p.slug === opts.slug);
      if (!hit) {
        process.stderr.write(
          `${ansi.yellow(`No page with slug '${opts.slug}' on website ${opts.website}.`)}\n`,
        );
        process.exitCode = 1;
        return;
      }
      recordResponseMetadata({ resourceId: hit.id });
      if (opts.quiet) {
        console.log(hit.id);
      } else {
        console.log(render({ format: ctx.format, data: hit, columns: PAGE_COLUMNS }));
      }
    });

  page.addCommand(buildPageDraftCommand(getGlobal));

  return page;
}

function buildPageDraftCommand(getGlobal: () => GlobalOptions): Command {
  const draft = new Command("draft").description(
    "Work with the pending draft of a page. A draft is the staging copy " +
    "edits land in when you update a published page without --publish; it " +
    "is not visible to visitors until you `page publish` it (or `page draft " +
    "publish`, which is an alias).",
  );

  draft
    .command("ls <website-id>")
    .description("List pages that have a pending draft")
    .action(async (websiteId: string) => {
      const ctx = await createContext(getGlobal());
      const items = await ctx.client.request<Page[]>(
        `/api/v1/websites/${websiteId}/pages`,
      );
      const withDraft = items.filter((p) => p.has_draft);
      recordResponseMetadata({ itemsCount: withDraft.length });
      console.log(
        render({ format: ctx.format, data: withDraft, columns: PAGE_COLUMNS }),
      );
    });

  draft
    .command("show <id>")
    .description("Show the draft title and content of a page")
    .action(async (id: string) => {
      const ctx = await createContext(getGlobal());
      const result = await fetchPageRequiringDraft(ctx.client, id, ctx.format);
      if (!result) return;
      const { page: item } = result;
      const payload = {
        page_id: item.id,
        draft_title: item.draft_title,
        draft_content: item.draft_content,
      };
      if (ctx.format === "json" || ctx.format === "yaml") {
        console.log(render({ format: ctx.format, data: payload }));
        return;
      }
      console.log(`Draft title: ${item.draft_title ?? "(unchanged)"}`);
      console.log("Draft content:");
      console.log(item.draft_content ?? "(unchanged)");
    });

  draft
    .command("diff <id>")
    .description("Show the difference between live content and draft content")
    .option("--no-color", "Disable ANSI colour output")
    .option("--context <n>", "Lines of unchanged context around changes", "3")
    .action(
      async (
        id: string,
        opts: { color?: boolean; context: string },
      ) => {
        const ctx = await createContext(getGlobal());
        const result = await fetchPageRequiringDraft(ctx.client, id, ctx.format, {
          hunks: [],
        });
        if (!result) return;
        const { page: item } = result;
        const liveTitle = item.title;
        const draftTitle = item.draft_title ?? item.title;
        const hunks = lineDiff(item.content, item.draft_content ?? item.content);
        const stats = diffStats(hunks);
        if (ctx.format === "json" || ctx.format === "yaml") {
          console.log(
            render({
              format: ctx.format,
              data: {
                page_id: item.id,
                title: { live: liveTitle, draft: draftTitle },
                stats,
                hunks,
              },
            }),
          );
          return;
        }
        if (liveTitle !== draftTitle) {
          console.log(`Title: ${liveTitle}  ->  ${draftTitle}`);
        }
        console.log(
          `Content: +${stats.added} -${stats.removed} (${stats.kept} unchanged)`,
        );
        if (stats.added === 0 && stats.removed === 0) return;
        const useColor = opts.color !== false && process.stdout.isTTY === true;
        const contextN = Number.parseInt(opts.context, 10);
        console.log(
          renderDiff(hunks, {
            color: useColor,
            context: Number.isFinite(contextN) ? contextN : 3,
          }),
        );
      },
    );

  draft
    .command("discard <id>")
    .description("Drop the pending draft, keep live content untouched")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (id: string, opts: { yes?: boolean }) => {
      const ctx = await createContext(getGlobal());
      // Pre-flight GET: needed to (a) show the page title in the confirm
      // prompt, (b) short-circuit cleanly when there is no draft to discard.
      // Runs even with --yes so a scripted "discard everything" loop is a
      // no-op for already-clean pages instead of issuing wasted DELETEs.
      const pg = await ctx.client.request<Page>(`/api/v1/pages/${id}`);
      const label = `'${pg.title}' (${pg.id})`;
      if (!pg.has_draft) {
        process.stderr.write(
          `${ansi.yellow(`No pending draft for ${label}. Nothing to discard.`)}\n`,
        );
        return;
      }
      const proceed = await confirm({
        prompt: `Discard draft of page ${label}? Live content will be kept.`,
        yes: opts.yes ?? false,
      });
      if (!proceed) {
        console.log("Aborted.");
        return;
      }
      const item = await ctx.client.request<Page>(
        `/api/v1/pages/${id}/draft`,
        { method: "DELETE" },
      );
      recordResponseMetadata({ resourceId: item.id });
      console.log(
        render({ format: ctx.format, data: item, columns: PAGE_COLUMNS }),
      );
    });

  draft
    .command("publish <id>")
    .description(
      "Promote the draft to live (alias for `sncb page publish <id>`)",
    )
    .action(async (id: string) => {
      const ctx = await createContext(getGlobal());
      const item = await ctx.client.request<Page>(
        `/api/v1/pages/${id}/publish`,
        { method: "POST" },
      );
      recordResponseMetadata({ resourceId: item.id });
      console.log(
        render({ format: ctx.format, data: item, columns: PAGE_COLUMNS }),
      );
    });

  return draft;
}
