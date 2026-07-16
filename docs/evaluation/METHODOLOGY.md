# Evaluation dataset methodology

The golden set is a versioned research artifact, not an informal list of prompts. Every case records its scope, expected facts, evidence, difficulty, answerability, authorship, and review state.

## Admission workflow

1. **Draft:** a human, script, or LLM may propose a case. Drafts remain visible but are excluded from scored benchmarks.
2. **Source verified:** the question, expected facts, and evidence location have been checked against the locally acquired source snapshot.
3. **Human approved:** a thesis reviewer has accepted the wording, evidence, and expected behavior. Final thesis tables should use this state unless a table is explicitly labelled exploratory.
4. **Retired:** the case remains in history but is not scored, with the retirement reason preserved in the change history.

An LLM must never promote its own generated case directly to `human-approved`. This avoids silently using model output as ground truth.

## Alternatives and decisions

| Decision | Alternatives retained for comparison | Current choice | Reason | Revisit trigger |
|---|---|---|---|---|
| Ground-truth format | Free-form answers; key facts; exact spans | Key facts plus source/page evidence and optional reference answer | Supports retrieval metrics, answer metrics, and auditability without relying on exact string matching | If claim-level scoring requires atomic evidence spans |
| Review states | Binary approved flag; no state; staged review | Draft → source verified → human approved → retired | Separates automatic curation from thesis-grade validation | If multiple independent annotators are introduced |
| Negative cases | Only answerable questions; unrelated questions; missing-detail questions | Include explicit unanswerable cases | Measures abstention and reduces confident answers outside corpus scope | When adding partially answerable cases |
| Dataset storage | Database; JSONL; versioned JSON | Versioned JSON plus generated Markdown/CSV summaries | Easy schema evolution, review, hashing, and reproducible experiments at current scale | If the dataset grows beyond convenient code review size |

## Required experiment linkage

Every scored experiment must store the golden-set path, SHA-256 hash, included review states, corpus manifest hashes, configuration hash, code fingerprint, model identifiers, metrics, timings, and failures. Changing any of these creates a new run; previous attempts remain immutable.

Embedding inputs are role-specific: corpus chunks use `RETRIEVAL_DOCUMENT` and
RAG questions use `QUESTION_ANSWERING`. With `gemini-embedding-2`, the provider
role is expressed using the documented `title: ... | text: ...` and
`task: question answering | query: ...` prompt formats; the legacy `taskType`
request field is not supported by this model. Provider, exact model identifier, task type,
output dimensionality, and the exact input hash form the persistent cache key.
Consequently, a cache hit may reduce latency and cost but must return the same
stored vector and cannot silently cross model or task boundaries.

Before a paid retrieval run, the dry-run estimator records requested and unique
texts, cache hits and misses, avoided API requests, character counts,
approximate tokens, the declared price assumption, and estimated cost. The
default token estimate is `ceil(characters / 4)` per input. This is a planning
measure only: thesis reporting must keep estimates distinct from any provider
billing or usage metadata. Dollar cost is left null unless a dated price per
million tokens is explicitly configured. Because shared cache state affects
cost and latency, candidate execution order and the pre-run cache report are
part of the experimental record; retrieval quality metrics remain the basis for
technical comparison.

Threshold calibration varies only `retrieval.minScore` and reuses one frozen
set of document/query vectors. The sweep must run in cache-only mode so cost and
provider availability cannot differ across threshold candidates. The primary
objective is lower no-answer false-positive rate; answerable-case Recall@k and
MRR are guardrails. When candidates tie, prefer nDCG and then the lowest
threshold, preserving the largest safety margin for answerable questions.
Precision is reported but is not allowed to win merely because a high threshold
returns fewer chunks.

A threshold selected on the current seed set is diagnostic only. Final
calibration requires more answerable and unanswerable cases, a validation split
for selecting the threshold, and a held-out test split for reporting unbiased
performance. The threshold grid, selection rule, failures, and rejected values
remain versioned even when no candidate satisfies the guardrails.

The common chunk-size protocol records the Gemini Developer API standard text
price of USD 0.20 per million input tokens, observed on 2026-07-16 from Google's
official pricing page. It also fixes 768 output dimensions and synchronous
groups of 32 independent inputs. The output dimension does not affect token
price, but it affects cache size and cosine-comparison cost, so 768/1536/3072
must later be tested as a separate controlled axis. Provider prices are dated
assumptions and must be rechecked before final thesis runs.

Before preparing a comparison suite, the common benchmark validator must confirm that candidates differ only on the declared experimental path. The protocol hash covers the suite definition, each experiment configuration, all corpus manifests, and the golden set. Preparation additionally hashes the documents actually loaded; candidates with different content snapshots are retained but rejected as a controlled comparison. Exploratory readiness and thesis readiness are separate gates: source-verified seed cases may support engineering iteration, while thesis conclusions require human-approved cases and the declared language coverage.

## Planned metric families

- Retrieval: Recall@k, Precision@k, MRR, nDCG, evidence page/source hit rate, and no-answer false-positive rate.
- Generation: key-fact coverage, groundedness, citation correctness, completeness, refusal correctness, latency, and cost/token usage.
- Judge validation: agreement against a human-labelled subset, confusion matrix, rank correlation, calibration, and sensitivity to judge model/prompt.
