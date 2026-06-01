/**
 * Trust checks for the API base URL.
 *
 * The CLI attaches `Authorization: Bearer <token>` to whatever base URL it
 * resolves (--api-url flag, SNCB_API_URL env, or stored config). Two rules
 * keep that token safe:
 *
 *  1. Transport: refuse plain `http://` for any non-loopback host so the token
 *     is never sent in cleartext over the network. `http://localhost` (and
 *     other loopback hosts) stays allowed for local development.
 *  2. Host pinning is enforced by the caller (see lib/context.ts): a token read
 *     from stored config is only sent to the host it was stored for.
 *
 * Set SNCB_INSECURE=1 to allow plain http to a remote host (local-dev escape
 * hatch; never use it against a real token).
 */

export const DEFAULT_API_URL = "https://app.senecabot.com";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost");
}

export class InsecureApiUrlError extends Error {
  constructor(public readonly host: string) {
    super(
      `Refusing to send the API token over plaintext http to '${host}'. ` +
        `Use https, or set SNCB_INSECURE=1 to override for a loopback/dev host.`,
    );
    this.name = "InsecureApiUrlError";
  }
}

/**
 * Parse and security-check an API base URL. Requires a valid http/https URL,
 * and forbids plain http to a non-loopback host unless `allowInsecure` is set.
 * Throws on an invalid URL, a non-http(s) scheme, or an insecure remote http.
 */
export function parseApiUrl(
  raw: string,
  opts: { allowInsecure?: boolean } = {},
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`apiUrl is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`apiUrl must use http or https, got ${url.protocol}`);
  }
  if (
    url.protocol === "http:" &&
    !isLoopbackHost(url.hostname) &&
    opts.allowInsecure !== true
  ) {
    throw new InsecureApiUrlError(url.host);
  }
  return url;
}

export function isInsecureOptIn(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env["SNCB_INSECURE"] ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export class TokenHostMismatchError extends Error {
  constructor(
    public readonly storedHost: string,
    public readonly requestedHost: string,
  ) {
    super(
      `Refusing to send your stored API token to '${requestedHost}'. ` +
        `It was stored for '${storedHost}'. ` +
        `Pass --token for the new host, or --insecure-allow-token-host to override.`,
    );
    this.name = "TokenHostMismatchError";
  }
}
