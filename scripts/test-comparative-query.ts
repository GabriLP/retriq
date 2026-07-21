import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { buildComparativeSubqueries, extractComparativeTopic } from "../src/lib/rag/comparative-query";

type Benchmark = { cases: Array<{ id: string; question: string; expectedLanguages: string[] }> };

async function main() {
  const positive = JSON.parse(await fs.readFile("docs/evaluation/multi-technology-retrieval-benchmark.v1.json", "utf8")) as Benchmark;
  const negative = JSON.parse(await fs.readFile("docs/evaluation/multi-technology-negative-benchmark.v1.json", "utf8")) as Benchmark;
  const cases = [...positive.cases, ...negative.cases];

  assert.equal(cases.length, 16);
  for (const item of cases) {
    const topic = extractComparativeTopic(item.question, item.expectedLanguages);
    assert.ok(topic, `${item.id} should have a deterministically extractable topic.`);
    const focused = buildComparativeSubqueries(item.question, item.expectedLanguages, "focus-original");
    const structured = buildComparativeSubqueries(item.question, item.expectedLanguages, "topic-template");
    assert.equal(focused.parsed, true);
    assert.equal(structured.parsed, true);
    assert.deepEqual(Object.keys(focused.subqueries), item.expectedLanguages);
    assert.deepEqual(Object.keys(structured.subqueries), item.expectedLanguages);
    for (const language of item.expectedLanguages) {
      assert.match(focused.subqueries[language], new RegExp(language.replaceAll("+", "\\+"), "i"));
      assert.match(structured.subqueries[language], new RegExp(language.replaceAll("+", "\\+"), "i"));
    }
  }

  assert.equal(extractComparativeTopic("Compare C with Rust memory", ["C", "Rust"]), null);
  assert.match(buildComparativeSubqueries("Compare C with Rust memory", ["C", "Rust"], "topic-template").subqueries.C, /^Focus on C only\./);
  assert.throws(() => buildComparativeSubqueries("Question", ["C"], "focus-original"));

  console.log("Comparative query constructor tests passed for 16 benchmark cases.");
}

main().catch((error) => { console.error(error); process.exit(1); });
