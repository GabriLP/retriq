# Corpus source selection and exclusions

This register explains why each expansion source was accepted, deferred, or rejected. It complements the machine-readable manifest and must be updated when the corpus changes.

## 2026-07-14 expansion

| Source | Format | Decision | Rationale and limitations |
|---|---|---|---|
| [C++ N5046 working draft](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2026/n5046.pdf) | PDF | Included | Current public WG21 working draft at selection time. It is authoritative as a draft, not equivalent to a purchased final ISO standard, and its 2,679 pages require balance controls. |
| [ECMA-262, 17th edition](https://www.ecma-international.org/wp-content/uploads/ECMA-262.pdf) | PDF | Included with caveat | Official 2026 printable specification. Ecma identifies the HTML edition as normative, so the experiment record must not describe the PDF as the normative copy. |
| [Kotlin language specification](https://kotlinlang.org/spec/pdf/kotlin-spec.pdf) | PDF | Included with caveat | Official specification PDF. The publisher marks the specification as experimental, which is recorded in manifest metadata and must be visible in thesis claims. |
| [GNU Bash 5.3 Reference Manual](https://www.gnu.org/software/bash/manual/bash.pdf) | PDF | Included | Official versioned manual and a useful command-language domain distinct from the existing general-purpose languages. |
| [GNU C Library 2.42 Reference Manual](https://sourceware.org/glibc/manual/2.42/pdf/libc.pdf) | PDF | Included | Canonical implementation/library reference that complements the C language standard and tutorial sources. The versioned Sourceware URL is used to avoid silent upstream replacement. |
| [Go language specification](https://go.dev/ref/spec) | HTML | Included | Official current specification. HTML is retained because no equally authoritative publisher PDF was identified. |
| [Python 3.14 documentation](https://docs.python.org/3.14/download.html) | HTML | Retained as HTML | Python no longer distributes current pre-built PDFs. An older PDF archive exists, but using it would silently mix publication dates; official living HTML is preferred. |
| Scala specification | PDF/HTML | Deferred | Scala 3 specification materials explicitly describe important missing features. Adding it now would increase breadth while weakening comparability and ground-truth confidence. |
| Unofficial Rust/TypeScript PDF conversions | PDF | Rejected | The format preference does not justify replacing official HTML with third-party conversions of uncertain version and provenance. |

## Acquisition incident log

| Date | Source | Attempt | Outcome | Corrective action |
|---|---|---|---|---|
| 2026-07-14 | GNU C Library manual | `https://www.gnu.org/s/libc/manual/pdf/libc.pdf` | Rejected automatically because the response contained HTML rather than a `%PDF-` header. | Replaced with the official versioned Sourceware 2.42 PDF URL; acquisition succeeded and the downloaded bytes were hashed. |

## Balance policy

Corpus expansion is stopped by methodological quality, not by a fixed file count. Before final experiments:

1. report endpoints, source families, languages, document roles, authority, and version stability;
2. report actual documents, words, chunks, and evidence cases per language after parsing;
3. use per-language metrics and macro averages so React volume cannot dominate the conclusion;
4. cap or stratify training/index samples when one language contributes a disproportionate number of chunks;
5. grow the golden set alongside the corpus, with human approval for final thesis cases.
