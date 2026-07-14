# PDF parsing progress report

Generated: 2026-07-14T16:47:13.789Z

> Partial rows are page-range smoke tests, not approval of complete documents. Full rows have processed every page but still require all reported issues to be resolved or explicitly verified.

- PDF documents: **12**
- Complete documents: **5**
- Partial smoke tests: **7**
- Raw pass: **6**
- Raw review: **6**
- Effective pass after verified exceptions: **12**
- Unresolved review: **0**

| Source | Scope | Pages | Words | Raw | Effective | Issues | Accepted exceptions | Time ms |
|---|---|---:|---:|---|---|---|---|---:|
| postgresql-18-manual | full | 3130 | 1178340 | review | pass | p380:empty_text; p1555:empty_text; p2827:empty_text; p2828:empty_text; p2829:empty_text; p2830:empty_text; p2831:empty_text; p2832:empty_text; p2833:empty_text; p3025:empty_text | p380:empty_text; p1555:empty_text; p2827:empty_text; p2828:empty_text; p2829:empty_text; p2830:empty_text; p2831:empty_text; p2832:empty_text; p2833:empty_text; p3025:empty_text | 2378000 |
| java-se-26-language-specification | full | 892 | 272755 | review | pass | p28:empty_text; p34:empty_text; p71:high_symbol_ratio; p72:empty_text; p126:empty_text; p157:high_symbol_ratio; p226:empty_text; p260:empty_text; p438:empty_text; p452:empty_text; p660:empty_text; p790:empty_text; p856:empty_text; p886:empty_text; p892:empty_text | p28:empty_text; p34:empty_text; p71:high_symbol_ratio; p72:empty_text; p126:empty_text; p157:high_symbol_ratio; p226:empty_text; p260:empty_text; p438:empty_text; p452:empty_text; p660:empty_text; p790:empty_text; p856:empty_text; p886:empty_text; p892:empty_text | 413391 |
| java-se-26-vm-specification | full | 624 | 129670 | review | pass | p84:empty_text; p368:empty_text; p412:empty_text; p476:empty_text; p614:empty_text; p624:empty_text | p84:empty_text; p368:empty_text; p412:empty_text; p476:empty_text; p614:empty_text; p624:empty_text | 259312 |
| c11-working-draft-n1570 | full | 701 | 219496 | pass | pass | — | — | 556390 |
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
