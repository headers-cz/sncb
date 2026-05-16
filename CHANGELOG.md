# Changelog

## [0.4.0](https://github.com/headers-cz/sncb/compare/v0.3.0...v0.4.0) (2026-05-16)


### Features

* [SNC-97] initial sncb CLI on Bun ([4183d85](https://github.com/headers-cz/sncb/commit/4183d85934c327d81c32869da92eba8b63f3b738))
* **cli:** [SNC-97] adapt to unified API v1 contract, add verbose + actionable errors ([f5491be](https://github.com/headers-cz/sncb/commit/f5491be2fee9205057efb2a0bedc0389270a14e9))
* **cli:** [SNC-97] add audit log + interactive delete confirmation ([737d984](https://github.com/headers-cz/sncb/commit/737d984ba90e445e78872d72dc8e7d388d696e36))
* **cli:** [SNC-97] add config command and seneca branding in help ([64fdd74](https://github.com/headers-cz/sncb/commit/64fdd7441183a8b271f7073c92934553e4e7c5c2))
* **cli:** [SNC-97] page create --publish/--quiet + page find by slug ([3812c0f](https://github.com/headers-cz/sncb/commit/3812c0f0630831fee89aa53c3f68629c191e3caf))
* **cli:** [SNC-97] page draft subcommand group + DRAFT column in list ([67b0d4e](https://github.com/headers-cz/sncb/commit/67b0d4e727d846482647eb70646ef25ebe9a7c58))
* **cli:** [SNC-97] page update draft hint + --publish flag ([c8a4101](https://github.com/headers-cz/sncb/commit/c8a41010dca2f79af4239efa3aac2ceecb8161b5))
* **cli:** [SNC-97] redesign root help screen ([c81f487](https://github.com/headers-cz/sncb/commit/c81f487e6fb5301907ff68ef7fe33f8cdcdfc8dd))
* **cli:** [SNC-97] surface page draft state + add --publish flag ([fb55278](https://github.com/headers-cz/sncb/commit/fb552786426947567ab37c38cca0208ad5c6768c))


### Bug Fixes

* **cli:** [SNC-97] address coderabbit review + restore CI coverage ([8c00f52](https://github.com/headers-cz/sncb/commit/8c00f522da4f785a202d8bb181122db7c44d8dac))

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
