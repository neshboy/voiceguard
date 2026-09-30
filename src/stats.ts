/**
 * Shared basic statistics used across the DSP heuristics. Previously
 * mean/stddev/coefficientOfVariation were implemented independently (and
 * identically) in both silence.ts and score.ts; kept here in one place so
 * the two call sites can't silently drift out of sync if only one is
 * edited. (spectral.ts separately exports its own standalone mean() for its
 * own use; this module is for the mean/stddev/CV trio specifically.)
 */

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) * (v - m), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Coefficient of variation (stddev / mean); null when undefined (fewer than
 * two samples, or a non-positive mean).
 */
export function coefficientOfVariation(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values);
  if (m <= 0) return null;
  return stddev(values) / m;
}
