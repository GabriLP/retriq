# PDF parsing smoke report

Generated: 2026-07-14T09:05:05.274Z

> This is a page-range smoke test, not approval of the complete documents. Full parsing must be checked separately before thesis experiments.

- PDF documents: **12**
- Raw pass: **9**
- Raw review: **3**
- Effective pass after verified exceptions: **12**
- Unresolved review: **0**

| Source | Pages | Words | Raw | Effective | Issues | Accepted exceptions | Time ms |
|---|---:|---:|---|---|---|---|---:|
| postgresql-18-manual | 1-3 | 647 | pass | pass | — | — | 9500 |
| java-se-26-language-specification | 1-3 | 265 | pass | pass | — | — | 1422 |
| java-se-26-vm-specification | 1-3 | 312 | pass | pass | — | — | 1312 |
| c11-working-draft-n1570 | 1-3 | 4291 | pass | pass | — | — | 40219 |
| beej-c-tutorial | 1-3 | 2464 | pass | pass | — | — | 14812 |
| beej-c-library-reference | 1-3 | 1873 | pass | pass | — | — | 14015 |
| open-data-structures-java | 1-3 | 72 | review | pass | p1:high_symbol_ratio; p2:empty_text | p1:high_symbol_ratio; p2:empty_text | 2829 |
| cpp26-working-draft-n5046 | 1-3 | 1285 | pass | pass | — | — | 14437 |
| ecmascript-2026-ecma-262 | 1-3 | 4040 | pass | pass | — | — | 3375 |
| kotlin-language-specification | 1-3 | 2137 | review | pass | p2:empty_text | p2:empty_text | 14438 |
| gnu-bash-5-3-reference-manual | 1-3 | 1233 | pass | pass | — | — | 7187 |
| gnu-c-library-2-42-manual | 1-3 | 30 | review | pass | p2:empty_text | p2:empty_text | 937 |

## Decision rule

- An exception is exact-match only: source, page number, and issue code.
- Every exception requires a reason, verification date, and verification method in the corpus manifest.
- A new issue or the same issue on another page remains blocking under the corpus fail policy.
