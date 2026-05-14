export function compareSemver(a: string, b: string): number {
  const parse = (v: string): number[] => {
    const main = v.split("-")[0] ?? v;
    return main.split(".").map((n) => Number.parseInt(n, 10) || 0);
  };
  const aa = parse(a);
  const bb = parse(b);
  for (let i = 0; i < 3; i++) {
    const ai = aa[i] ?? 0;
    const bi = bb[i] ?? 0;
    if (ai !== bi) return ai > bi ? 1 : -1;
  }
  return 0;
}

export function isNewer(candidate: string, current: string): boolean {
  return compareSemver(candidate, current) > 0;
}
