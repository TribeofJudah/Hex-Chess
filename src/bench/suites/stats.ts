/**
 * Small statistics used by the suites' metrics. Pure functions of counts:
 * every metric in §4 is rebuildable from the JSONL alone.
 */

/** Two-sided 95% normal quantile. */
export const Z95 = 1.959963984540054

/**
 * Wilson score interval for a binomial rate. Unlike the normal approximation
 * this stays inside [0, 1] and never collapses to a point at 0/n or n/n.
 * `[0, 1]` with no trials, which is honest: nothing was observed.
 */
export function wilson(
  successes: number,
  n: number,
  z: number = Z95,
): [number, number] {
  if (n <= 0) return [0, 1]
  const p = successes / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const half =
    (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return [Math.max(0, center - half), Math.min(1, center + half)]
}

/**
 * Shannon entropy of an observed distribution, in bits. 0 when every
 * observation is the same one — what S4 expects of a deterministic agent.
 */
export function entropyBits(counts: Iterable<number>): number {
  // Materialized: an iterator is single-use, and this walks the counts twice.
  const list = [...counts]
  let total = 0
  for (const c of list) total += c
  if (total <= 0) return 0
  let bits = 0
  for (const c of list) {
    if (c <= 0) continue
    const p = c / total
    bits -= p * Math.log2(p)
  }
  return bits
}
