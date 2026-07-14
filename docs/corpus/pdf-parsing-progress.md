# PDF parsing progress report

Generated: 2026-07-14T13:30:02.840Z

> Partial rows are page-range smoke tests, not approval of complete documents. Full rows have processed every page but still require all reported issues to be resolved or explicitly verified.

- PDF documents: **12**
- Complete documents: **2**
- Partial smoke tests: **10**
- Raw pass: **8**
- Raw review: **4**
- Effective pass after verified exceptions: **12**
- Unresolved review: **0**

| Source | Scope | Pages | Words | Raw | Effective | Issues | Accepted exceptions | Time ms |
|---|---|---:|---:|---|---|---|---|---:|
| postgresql-18-manual | full | 3130 | 1178340 | review | pass | p380:empty_text; p1555:empty_text; p2827:empty_text; p2828:empty_text; p2829:empty_text; p2830:empty_text; p2831:empty_text; p2832:empty_text; p2833:empty_text; p3025:empty_text | p380:empty_text; p1555:empty_text; p2827:empty_text; p2828:empty_text; p2829:empty_text; p2830:empty_text; p2831:empty_text; p2832:empty_text; p2833:empty_text; p3025:empty_text | 2378000 |
| java-se-26-language-specification | partial | 1-3 | 265 | pass | pass | — | — | 1422 |
| java-se-26-vm-specification | partial | 1-3 | 312 | pass | pass | — | — | 1312 |
| c11-working-draft-n1570 | partial | 1-3 | 4291 | pass | pass | — | — | 40219 |
| beej-c-tutorial | partial | 1-3 | 2464 | pass | pass | — | — | 14812 |
| beej-c-library-reference | partial | 1-3 | 1873 | pass | pass | — | — | 14015 |
| open-data-structures-java | full | 204 | 61036 | review | pass | p1:high_symbol_ratio; p2:empty_text; p4:empty_text; p26:empty_text; p72:empty_text; p88:empty_text; p110:empty_text; p124:empty_text; p140:empty_text; p150:empty_text | p1:high_symbol_ratio; p2:empty_text; p4:empty_text; p26:empty_text; p72:empty_text; p88:empty_text; p110:empty_text; p124:empty_text; p140:empty_text; p150:empty_text | 79859 |
| cpp26-working-draft-n5046 | partial | 1-3 | 1285 | pass | pass | — | — | 14437 |
| ecmascript-2026-ecma-262 | partial | 1-3 | 4040 | pass | pass | — | — | 3375 |
| kotlin-language-specification | partial | 1-3 | 2137 | review | pass | p2:empty_text | p2:empty_text | 14438 |
| gnu-bash-5-3-reference-manual | partial | 1-3 | 1233 | pass | pass | — | — | 7187 |
| gnu-c-library-2-42-manual | partial | 1-3 | 30 | review | pass | p2:empty_text | p2:empty_text | 937 |

## Decision rule

- An exception is exact-match only: source, page number, and issue code.
- Every exception requires a reason, verification date, and verification method in the corpus manifest.
- A new issue or the same issue on another page remains blocking under the corpus fail policy.
