# sncb

CLI for the Seneca REST API. Manage websites, pages, folders, and agent configuration from your terminal or scripts.

Runs on [Bun](https://bun.com) (>= 1.3). Designed for CI/CD pipelines and quick local edits.

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

Token is stored at `~/.config/sncb/config.json` with mode `0600`. Override with:
- `--token <token>` flag (per invocation)
- `SNCB_TOKEN` env var
- `--api-url <url>` / `SNCB_API_URL` for staging/dev

## Usage

```bash
sncb health
sncb website list
sncb website get <id>
sncb website create --name "Docs" --domain docs.example.com
sncb website update <id> --domain new.example.com
sncb website delete <id>

sncb website design get <id>
sncb website design update <id> -f design.json
sncb website domain get <id>
sncb website domain update <id> --domain new.example.com

sncb page list <website-id>
sncb page get <id>
sncb page create --website <id> --title "Hello" --slug hello -f page.html
sncb page create --website <id> --title "Inline" --slug inline -f -    # stdin
sncb page update <id> --title "New title"
sncb page publish <id>
sncb page move <id> --folder <folder-id>
sncb page versions <id>
sncb page delete <id>

sncb folder list <website-id>
sncb folder create --website <id> --name "Docs"
sncb folder update <id> --name "Renamed"
sncb folder delete <id>

sncb agent get
sncb agent update -f agent.json
```

### Output formats

Default is a human-readable table. Switch via:
- `--json` (alias for `--output json`)
- `-o yaml`
- `-o table` (default)

JSON output is stable for scripting.

### Exit codes

- `0` success
- `1` user/client error (4xx, validation, missing flags)
- `2` server error (5xx)
- `3` network error (DNS, timeout, connection refused)
- `4` not authenticated

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
bun test                  # 128 tests
bun test --coverage       # coverage report
bun run lint
bun run typecheck
bun run build             # produces dist/cli.js
```

## License

UNLICENSED - internal to Headers.
