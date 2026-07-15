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
questions use `RETRIEVAL_QUERY`. Provider, exact model identifier, task type,
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

Before preparing a comparison suite, the common benchmark validator must confirm that candidates differ only on the declared experimental path. The protocol hash covers the suite definition, each experiment configuration, all corpus manifests, and the golden set. Preparation additionally hashes the documents actually loaded; candidates with different content snapshots are retained but rejected as a controlled comparison. Exploratory readiness and thesis readiness are separate gates: source-verified seed cases may support engineering iteration, while thesis conclusions require human-approved cases and the declared language coverage.

## Planned metric families

- Retrieval: Recall@k, Precision@k, MRR, nDCG, evidence page/source hit rate, and no-answer false-positive rate.
- Generation: key-fact coverage, groundedness, citation correctness, completeness, refusal correctness, latency, and cost/token usage.
- Judge validation: agreement against a human-labelled subset, confusion matrix, rank correlation, calibration, and sensitivity to judge model/prompt.
