import assert from "node:assert/strict";
import { agreement, meanAbsoluteError, normalizedQuality, passesQuality, quadraticWeightedKappa, spearmanCorrelation } from "../src/lib/evaluation/judge-metrics";

assert.equal(quadraticWeightedKappa([0, 1, 2, 3, 4], [0, 1, 2, 3, 4], 4), 1);
assert.ok(quadraticWeightedKappa([0, 1, 2, 3, 4], [4, 3, 2, 1, 0], 4) < 0);
assert.equal(spearmanCorrelation([1, 2, 3, 4], [10, 20, 30, 40]), 1);
assert.equal(spearmanCorrelation([1, 2, 3, 4], [40, 30, 20, 10]), -1);
assert.equal(spearmanCorrelation([1, 1, 1], [1, 2, 3]), null);
assert.equal(agreement([true, false, true], [true, true, true]), 2 / 3);
assert.equal(meanAbsoluteError([0, 2, 4], [1, 2, 2]), 1);

const passing = {
  answerability: "answerable" as const,
  groundedness: 4,
  keyFactCoverage: 3,
  citationCorrectness: 4,
  citationCompleteness: 3,
  directness: 2,
  correctAbstention: null,
  criticalUnsupportedClaim: 0,
  contradictsEvidence: 0,
  invalidCitationLabel: 0,
  generatorFailure: 0,
};
assert.equal(normalizedQuality(passing), 14 / 16);
assert.equal(passesQuality(passing), true);
assert.equal(passesQuality({ ...passing, groundedness: 2 }), false);
assert.equal(passesQuality({ ...passing, generatorFailure: 1 }), false);

console.log("VALID judge metrics and pass rule.");
