// Per the NO_COLOR spec (https://no-color.org/), any value - including the
// empty string - disables ANSI. So check key presence, not truthiness.
const useColor = process.stdout.isTTY && !("NO_COLOR" in process.env);

function wrap(open: string, close: string = "0"): (s: string) => string {
  return (s: string): string =>
    useColor ? `\x1b[${open}m${s}\x1b[${close}m` : s;
}

export const ansi = {
  bold: wrap("1", "22"),
  dim: wrap("2"),
  red: wrap("31"),
  green: wrap("32"),
  yellow: wrap("33"),
  cyan: wrap("36"),
};
