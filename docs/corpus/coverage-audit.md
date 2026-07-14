# Corpus coverage audit

Generated: 2026-07-14T14:45:26.381Z

- Document endpoints: **99**
- Source families: **15**
- Languages/domains: **12**
- PDF documents: **12**

An endpoint is a URL or PDF entry. A source family groups related pages from the same publisher, so the React site is not incorrectly counted as dozens of independent sources.

## Coverage targets

| Check | Actual | Target | Status |
|---|---:|---:|---|
| Minimum languages | 12 | 10 | pass |
| Minimum PDF documents | 12 | 10 | pass |
| Minimum official source families | 13 | 8 | pass |
| Maximum single-language endpoint share | 0.8081 | 0.6500 | fail |

## Distributions

| Dimension | Distribution |
|---|---|
| Languages | Bash: 1; C: 4; C++: 1; Go: 1; Java: 3; JavaScript: 1; Kotlin: 1; PostgreSQL / SQL: 1; Python: 2; React: 80; Rust: 2; TypeScript: 2 |
| Formats | html: 87; pdf: 12 |
| Authority | academic-secondary: 1; expert-secondary: 2; official: 91; official-experimental-specification: 1; official-implementation-reference: 1; official-standard: 1; standards-body-draft: 2 |
| Document roles | handbook: 1; handbook-chapter: 1; language-reference: 3; language-specification: 6; library-reference: 2; official-book: 1; official-guide-and-reference: 80; official-reference: 1; textbook: 1; tutorial: 2; virtual-machine-specification: 1 |

## Source families

| Family | Endpoints |
|---|---:|
| beej-c-guides | 2 |
| ecma-language-standards | 1 |
| gnu-bash-manual | 1 |
| gnu-c-library-manual | 1 |
| go-official-specification | 1 |
| kotlin-official-specification | 1 |
| open-data-structures | 1 |
| oracle-java-se-specifications | 2 |
| postgresql-official-manual | 1 |
| python-official-documentation | 2 |
| react-official-documentation | 80 |
| rust-official-documentation | 2 |
| typescript-official-documentation | 2 |
| wg14-c-working-drafts | 1 |
| wg21-cpp-working-drafts | 1 |

## Methodological cautions

- React still dominates endpoint count because its official documentation is split across many pages. Final experiments must report chunk distribution by language and may need stratified sampling or per-language metrics.
- Working drafts and living manuals are valid research sources only when the acquired bytes are frozen by hash and the document status is shown in the thesis.
- PDF preference does not override authority: official HTML remains preferable when the publisher identifies it as normative or no current PDF is distributed.
- Corpus size alone does not establish quality. Golden-set coverage and evidence diversity must grow with the corpus.

## Metadata warnings

No missing required metadata detected.
