/** Money helpers — work in integer cents to avoid float drift (DOMAIN-SPEC §8). */
export function toCents(amount: string | number): number {
  return Math.round(Number(amount) * 100);
}
export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}
/** cents of `base` × `percent`% (percent may have decimals), rounded to a cent. */
export function percentOfCents(baseCents: number, percent: string | number): number {
  return Math.round((baseCents * Number(percent)) / 100);
}
