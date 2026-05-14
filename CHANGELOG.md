# Changelog

## 0.3.0 (2026-05-14)

### Breaking changes

* `sncb website|page|folder delete <id>` now requires confirmation:
  * Interactive TTY: prompts `[y/N]` (and fetches the resource name first
    so you see what you're about to delete).
  * Non-interactive (pipes, CI, AI agents): refuses unless `-y`/`--yes`
    is passed. This is a deliberate safety bar against silent deletes by
    AI agents acting on the user's behalf.

### Features

* **Local audit log** for every sncb invocation.
  * Path: `$XDG_STATE_HOME/sncb/audit.log` (default
    `~/.local/state/sncb/audit.log`), JSON Lines format.
  * Records command, args, flags (token redacted), endpoint, status,
    duration, outcome, and resource_id/items_count when applicable.
  * Subcommands: `sncb audit tail [--last N] [--since 1h] [--filter X]
    [--json]`, `sncb audit path`, `sncb audit clear [--older-than 30d]
    [-y]`.
  * Disable per-shell with `SNCB_AUDIT=off` (e.g. inside CI that already
    captures server-side audit).
* New `-y, --yes` flag on delete commands skips the confirmation prompt.

### Privacy & safety

* The audit log never persists: API tokens, request bodies, or response
  bodies. Only structural metadata.



## 0.2.0 (2026-05-14)

### Breaking changes

* API surface now expects unified response and error shape from the Seneca API
  (see seneca-web v0.16+). Older API versions are not compatible.
* `sncb agent get` now requires an explicit `<id>` argument; new `sncb agent list`.
* `sncb folder` commands operate on the canonical `is_folder: true` page model:
  * `folder create` now uses `--title`/`--slug` (was `--name`).
  * `folder get`/`update`/`delete` route through `/api/v1/pages/<id>`.
* `sncb page` columns updated to `PUBLISHED`/`FOLDER`/`PARENT` (was `STATUS`/`FOLDER`).
* `sncb page unpublish <id>` replaces the previous `DELETE /pages/<id>/publish`
  pattern with an explicit endpoint.
* `sncb website create` now takes `--url <url>` (was `--domain`).

### Features

* `-v` / `--verbose` global flag logs every HTTP request and response to stderr.
* Actionable error hints for `invalid_token`, `insufficient_scope`,
  `rate_limit_exceeded`, 404, 409, and 5xx.
* `sncb page unpublish` and `sncb page revert <id> <version-id>` commands.
* `sncb folder list` now works (new GET endpoint on the API side).
* CLI types are now in sync with the API DTO layer.

### Fixes

* `sncb website list` (and other list commands) no longer returns empty - the
  client now correctly unwraps the `{ data: [...] }` envelope.
* `sncb agent get`/`update` no longer hit a non-existent `/api/v1/agent`
  singular endpoint.

## 0.1.0 (2026-05-14)

Initial release: auth, website/page/folder/agent CRUD, config, upgrade.
