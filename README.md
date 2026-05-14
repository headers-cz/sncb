# sncb

`sncb` is the command-line interface for [Seneca](https://senecabot.com) - the Headers platform for chatbots, knowledge bases, and help centers. Designed for humans on the terminal and for AI agents driving Seneca from scripts and CI.

Runs on [Bun](https://bun.com) (>= 1.3).

## Install

```bash
bun install -g @headers/sncb
```

After install, `sncb` is on your `$PATH`.

## Authentication

You need a per-organization API token issued in the Seneca console.

```bash
sncb auth login --token snc_live_xxx_yyyy
# or interactive:
sncb auth login

sncb auth whoami
sncb auth logout
```

Token is stored at `~/.config/sncb/config.json` with mode `0600` (XDG Base Directory spec, respects `XDG_CONFIG_HOME`).

Per-invocation overrides (highest priority first):

* `--token <token>` flag
* `SNCB_TOKEN` environment variable
* Stored config

Same priority applies to `--api-url` / `SNCB_API_URL`.

## Configuration

Read or modify the stored config from the CLI:

```bash
sncb config get                              # entire config, token masked
sncb config get apiUrl                       # one value
sncb config set apiUrl http://localhost:3002/ # update
sncb config set autoUpdate false
sncb config unset apiUrl                     # reset key to default
sncb config path                             # print config file path
```

## Usage

```bash
sncb health
sncb website list
sncb website get <id>
sncb website create --name "Docs" --url https://docs.example.com
sncb website update <id> --name "New" --domain docs.example.com
sncb website delete <id>

sncb website design update <id> --scheme design-01 --primary "#283593"

sncb page list <website-id>
sncb page get <id>
sncb page create --website <id> --title "Hello" --slug hello -f page.html
sncb page create --website <id> --title "Inline" --slug inline -f -    # stdin
sncb page update <id> --title "New title" -f page.html
sncb page publish <id>
sncb page unpublish <id>
sncb page move <id> --parent <folder-id>
sncb page versions <id>
sncb page revert <id> <version-id>
sncb page delete <id>

sncb folder list <website-id>
sncb folder get <id>
sncb folder create --website <id> --title "Docs" --slug docs
sncb folder update <id> --title "Renamed"
sncb folder delete <id>

sncb agent list
sncb agent get <id>
sncb agent update <id> -f agent.json
```

Folders are pages with `is_folder: true`; `folder` is a convenience namespace.

### Output formats

Default is a human-readable table. Switch via:

* `--json` (alias for `--output json`)
* `-o yaml`
* `-o table` (default)

JSON output is the stable contract for scripting and AI agents. Tables are best-effort and may change formatting between releases.

### Verbose mode

```bash
sncb -v website list
```

Logs every HTTP request and response to stderr (method, URL, status, duration). Useful for debugging integrations and grabbing request IDs for bug reports.

### Exit codes

* `0` success
* `1` user/client error (4xx, validation, missing flags)
* `2` server error (5xx)
* `3` network error (DNS, timeout, connection refused)
* `4` not authenticated (401 or no token)

### Error format

The Seneca API returns structured errors that `sncb` surfaces verbatim plus an actionable hint when one applies:

```text
API error (404 not_found): Page abc not found
  hint: resource not found, or it belongs to a different organization. Verify the id and your token's org.
```

In JSON mode (or via `-v`), the raw API error envelope is `{ error: { code, message, details? } }`.

## Auto-update

`sncb` checks npm once per 24 hours after any command (skipped for `sncb upgrade` itself). If a new version is available, you'll see a notice on stderr and a detached background install runs.

To disable:

```bash
sncb upgrade --no-auto-update
```

To force an update right now:

```bash
sncb upgrade            # installs latest if newer
sncb upgrade --check    # only report, no install
```

`sncb upgrade` invokes whichever package manager you used to install it (Bun, pnpm, or npm), detected from `npm_config_user_agent`.

## Configuration file

`~/.config/sncb/config.json`:

```json
{
  "apiUrl": "https://app.seneca.headers.cz",
  "token": "snc_live_xxx_yyyy",
  "autoUpdate": true,
  "lastUpdateCheckAt": 0,
  "lastSeenLatestVersion": null
}
```

Edit safely - it's a plain JSON file. Token field is sensitive; the file is created with `0600` permissions.

## Development

```bash
bun install
bun run dev -- --help     # run from source
bun test                  # 160 tests
bun test --coverage       # coverage report
bun run lint
bun run typecheck
bun run build             # produces dist/cli.js
```

## License

UNLICENSED - internal to Headers.
