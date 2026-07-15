export function summarizeChunkWords(wordCounts: number[], configuredMinimum: number, targetWords: number) {
  const sorted = [...wordCounts].sort((left, right) => left - right);
  const percentile = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
  return {
    minimum: sorted[0] ?? 0,
    p50: percentile(0.5),
    p90: percentile(0.9),
    p95: percentile(0.95),
    maximum: sorted.at(-1) ?? 0,
    belowConfiguredMinimum: sorted.filter((value) => value < configuredMinimum).length,
    atOrAboveTarget: sorted.filter((value) => value >= targetWords).length,
  };
}
