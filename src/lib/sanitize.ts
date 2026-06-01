/**
 * Neutralize terminal control sequences in server-controlled strings before
 * they are printed to a TTY.
 *
 * Any value that originates from the API (page titles, website names, error
 * messages, diff content, audit fields) is attacker-influenceable: a malicious
 * or MITM server can embed ANSI/CSI/OSC/DCS escape sequences that spoof output,
 * rewrite the screen, plant phishing hyperlinks, or overwrite a confirmation
 * prompt. The ESC byte (0x1B) is the entry point for all of them.
 *
 * `stripControl` replaces C0 control bytes (incl. ESC and CR), DEL, and C1
 * control bytes with a visible placeholder. By default it also folds TAB and
 * LF (single-line contexts: table cells, prompts, error lines). Pass
 * `{ multiline: true }` to preserve TAB and LF for genuinely multi-line text
 * (page content, diffs) while still stripping ESC/CR and the rest.
 *
 * Only use this for human-facing table/text output. NEVER apply it to JSON or
 * YAML output, or to data sent back to the API - it is lossy by design.
 */

// U+FFFD REPLACEMENT CHARACTER, written as an escape so this source file stays
// pure ASCII. Renders as a visible marker where a control byte was removed.
const PLACEHOLDER = "\uFFFD";

// C0 controls (0x00-0x1F, includes ESC 0x1B and CR 0x0D), DEL (0x7F), and C1
// controls (0x80-0x9F). Czech diacritics and other printable Unicode are >=
// 0x00A0 and are never matched.
// eslint-disable-next-line no-control-regex
const CONTROL_ALL = /[\x00-\x1F\x7F-\x9F]/g;

// Same set, but allow TAB (0x09) and LF (0x0A) through. CR (0x0D) is still
// stripped so it cannot return the cursor to the start of a line and overwrite
// already-printed output.
// eslint-disable-next-line no-control-regex
const CONTROL_KEEP_WHITESPACE = /[\x00-\x08\x0B-\x1F\x7F-\x9F]/g;

export interface StripControlOptions {
  /** Preserve TAB and LF (for multi-line text such as page content / diffs). */
  multiline?: boolean;
}

export function stripControl(value: string, options: StripControlOptions = {}): string {
  const pattern = options.multiline ? CONTROL_KEEP_WHITESPACE : CONTROL_ALL;
  return value.replace(pattern, PLACEHOLDER);
}
