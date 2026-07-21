export type JudgeLabel = {
  answerability: "answerable" | "unanswerable";
  groundedness: number | null;
  keyFactCoverage: number | null;
  citationCorrectness: number | null;
  citationCompleteness: number | null;
  directness: number | null;
  correctAbstention: number | null;
  criticalUnsupportedClaim: number;
  contradictsEvidence: number;
  invalidCitationLabel: number;
  generatorFailure: number;
};

export function normalizedQuality(label: JudgeLabel) {
  if (label.answerability === "unanswerable") return label.correctAbstention ?? 0;
  const values = [label.groundedness, label.keyFactCoverage, label.citationCorrectness, label.citationCompleteness];
  if (values.some((value) => value === null)) throw new Error("Answerable labels require all four core scores.");
  return values.reduce<number>((total, value) => total + (value ?? 0), 0) / 16;
}

export function passesQuality(label: JudgeLabel) {
  const noFlags = label.criticalUnsupportedClaim === 0
    && label.contradictsEvidence === 0
    && label.invalidCitationLabel === 0
    && label.generatorFailure === 0;
  if (!noFlags) return false;
  if (label.answerability === "unanswerable") return label.correctAbstention === 1;
  return [label.groundedness, label.keyFactCoverage, label.citationCorrectness, label.citationCompleteness]
    .every((value) => value !== null && value >= 3);
}

export function quadraticWeightedKappa(reference: number[], predicted: number[], maximumScore: number) {
  if (reference.length !== predicted.length || reference.length === 0) throw new Error("Kappa requires equally sized non-empty arrays.");
  const size = maximumScore + 1;
  const observed = Array.from({ length: size }, () => Array<number>(size).fill(0));
  const referenceCounts = Array<number>(size).fill(0);
  const predictedCounts = Array<number>(size).fill(0);
  for (let index = 0; index < reference.length; index += 1) {
    const left = reference[index];
    const right = predicted[index];
    validateOrdinal(left, maximumScore);
    validateOrdinal(right, maximumScore);
    observed[left][right] += 1;
    referenceCounts[left] += 1;
    predictedCounts[right] += 1;
  }
  let observedWeighted = 0;
  let expectedWeighted = 0;
  for (let left = 0; left < size; left += 1) {
    for (let right = 0; right < size; right += 1) {
      const weight = ((left - right) ** 2) / (maximumScore ** 2 || 1);
      observedWeighted += weight * observed[left][right];
      expectedWeighted += weight * (referenceCounts[left] * predictedCounts[right] / reference.length);
    }
  }
  if (expectedWeighted === 0) return reference.every((value, index) => value === predicted[index]) ? 1 : 0;
  return 1 - observedWeighted / expectedWeighted;
}

export function spearmanCorrelation(reference: number[], predicted: number[]) {
  if (reference.length !== predicted.length || reference.length < 2) throw new Error("Spearman requires equally sized arrays with at least two observations.");
  const left = ranks(reference);
  const right = ranks(predicted);
  const leftMean = mean(left);
  const rightMean = mean(right);
  let numerator = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSquares += leftDelta ** 2;
    rightSquares += rightDelta ** 2;
  }
  if (leftSquares === 0 || rightSquares === 0) return null;
  return numerator / Math.sqrt(leftSquares * rightSquares);
}

export function agreement(reference: boolean[], predicted: boolean[]) {
  if (reference.length !== predicted.length || reference.length === 0) throw new Error("Agreement requires equally sized non-empty arrays.");
  return reference.filter((value, index) => value === predicted[index]).length / reference.length;
}

export function meanAbsoluteError(reference: number[], predicted: number[]) {
  if (reference.length !== predicted.length || reference.length === 0) throw new Error("MAE requires equally sized non-empty arrays.");
  return mean(reference.map((value, index) => Math.abs(value - predicted[index])));
}

export function mean(values: number[]) {
  if (!values.length) throw new Error("Mean requires at least one value.");
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function ranks(values: number[]) {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const output = Array<number>(values.length);
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end += 1;
    const averageRank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) output[sorted[index].index] = averageRank;
    start = end;
  }
  return output;
}

function validateOrdinal(value: number, maximumScore: number) {
  if (!Number.isInteger(value) || value < 0 || value > maximumScore) throw new Error(`Invalid ordinal score ${value}.`);
}
