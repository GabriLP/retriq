import fs from "node:fs/promises";
import path from "node:path";

import type { DocumentationChunk } from "../src/lib/rag/types";
import type { ConfirmatoryBenchmark, ConfirmatoryCase } from "../src/lib/evaluation/confirmatory-benchmark";

const root = process.cwd();
const chunksFile = "data/experiments/baseline-gemini-300-v4-validation/20260717084956473-e60c88ec/chunks.json";
const outputFile = "docs/evaluation/confirmatory-benchmark.v1.review.json";
const createdAt = "2026-07-23T00:00:00.000Z";

type PositiveSpec = {
  slug: string;
  language: string;
  corpusLanguage?: string;
  domain: string;
  question: string;
  difficulty: "easy" | "medium" | "hard";
  questionType: "factual" | "procedural" | "comparative" | "multi-hop";
  answer: string;
  keyFacts: string[];
  needle: string;
  additionalNeedles?: string[];
  preferredSection?: string;
};

type NegativeSpec = {
  slug: string;
  language: string;
  domain: string;
  question: string;
  category: "out-of-corpus" | "adjacent-technology" | "vendor-specific" | "unsupported-version";
  refusalReason: string;
  probes: string[];
};

const positives: PositiveSpec[] = [
  {
    slug: "react-list-keys",
    language: "React", domain: "react", difficulty: "easy", questionType: "factual",
    question: "Why should React list items have stable keys, and where should those keys usually come from?",
    answer: "Keys uniquely identify sibling items and let React track insertions, deletions, and reordering; they should normally come from stable data such as database IDs.",
    keyFacts: ["A key identifies an item among its siblings.", "React uses keys to track list changes.", "Stable IDs from the underlying data are preferred."],
    needle: "React uses your keys to know what happened", preferredSection: "Creating and nesting components",
  },
  {
    slug: "react-hook-placement",
    language: "React", domain: "react", difficulty: "easy", questionType: "procedural",
    question: "Where may React Hooks be called, and what should be done if state is needed inside a condition or loop?",
    answer: "Hooks may be called only at the top level of components or other Hooks. Conditional or loop-specific state logic should be moved into a separate component or Hook.",
    keyFacts: ["Hooks are called at the top level.", "They may be called from components or other Hooks.", "Conditional or loop use should be refactored."],
    needle: "You can only call Hooks at the top", preferredSection: "Creating and nesting components",
  },
  {
    slug: "c-array-conversion",
    language: "C", domain: "c", difficulty: "medium", questionType: "factual",
    question: "Under C11, when does the usual conversion from an array expression to a pointer to its first element not occur?",
    answer: "The conversion does not occur when the array expression is the operand of sizeof, _Alignof, or unary &, or when it is a string literal used to initialize an array.",
    keyFacts: ["The usual conversion produces a pointer to the initial element.", "sizeof, _Alignof, and unary & are exceptions.", "A string literal used to initialize an array is also an exception."],
    needle: "or is a string literal used to initialize an array", preferredSection: "6.3.2.1",
  },
  {
    slug: "c-sequence-point",
    language: "C", domain: "c", difficulty: "medium", questionType: "factual",
    question: "What ordering guarantee does a sequence point provide between two C expression evaluations?",
    answer: "A sequence point between evaluations A and B means every value computation and side effect associated with A is sequenced before every value computation and side effect associated with B.",
    keyFacts: ["All value computations associated with A precede those of B.", "All side effects associated with A precede those of B."],
    needle: "presence of a sequence point between the evaluation", preferredSection: "5.1.2.3",
  },
  {
    slug: "java-record-purpose",
    language: "Java", domain: "java", difficulty: "easy", questionType: "factual",
    question: "What purpose do Java record classes serve according to the language specification?",
    answer: "Record classes are a restricted kind of class intended for compactly expressing simple objects that aggregate values.",
    keyFacts: ["A record is a restricted kind of class.", "It compactly represents an aggregate of values."],
    needle: "record classes, supports the compact expression", preferredSection: "1.1 Organization",
  },
  {
    slug: "java-resource-autocloseable",
    language: "Java", domain: "java", difficulty: "medium", questionType: "factual",
    question: "What type constraint applies to a resource used by a Java try-with-resources statement?",
    answer: "The type of a declared resource, or of an existing variable referenced as a resource, must be a subtype of AutoCloseable; otherwise a compile-time error occurs.",
    keyFacts: ["The resource type must be a subtype of AutoCloseable.", "The rule covers declared resources and referenced existing variables.", "Violation is a compile-time error."],
    needle: "must be a subtype of AutoCloseable", preferredSection: "14.20.3",
  },
  {
    slug: "postgres-mvcc-snapshot",
    language: "PostgreSQL", corpusLanguage: "PostgreSQL / SQL", domain: "postgresql", difficulty: "medium", questionType: "factual",
    question: "How does PostgreSQL MVCC give a statement a consistent view while reducing read-write contention?",
    answer: "Each statement reads from a data snapshot rather than inconsistent concurrent row changes. Under MVCC, read locks do not conflict with write locks, so reads and writes do not block one another in the usual case.",
    keyFacts: ["A statement sees a snapshot of data.", "The snapshot prevents inconsistent concurrent changes from being observed.", "Reading does not block writing and writing does not block reading."],
    needle: "each SQL statement sees a snapshot of data", preferredSection: "13.1. Introduction",
  },
  {
    slug: "postgres-gin-purpose",
    language: "PostgreSQL", corpusLanguage: "PostgreSQL / SQL", domain: "postgresql", difficulty: "medium", questionType: "factual",
    question: "What kind of data are PostgreSQL GIN indexes designed for, and how is an inverted index organized?",
    answer: "GIN indexes suit values with multiple components, such as arrays. They store a separate index entry for each component so presence queries can be handled efficiently.",
    keyFacts: ["GIN is an inverted index.", "It is suited to multi-component values such as arrays.", "It stores separate entries for component values."],
    needle: "GIN indexes are 'inverted indexes'", preferredSection: "11.2.5. GIN",
  },
  {
    slug: "cpp-structured-binding-size",
    language: "C++", domain: "cpp", difficulty: "hard", questionType: "factual",
    question: "How must the number of names in a C++ structured binding relate to the structured binding size when no binding pack is present?",
    answer: "Without a structured binding pack, the number of identifiers in the binding list must equal the structured binding size of the initializer type.",
    keyFacts: ["The rule applies when there is no structured binding pack.", "The identifier count must equal the structured binding size."],
    needle: "number of elements in the sb-identifier-list shall be equal", preferredSection: "[dcl.struct.bind]",
  },
  {
    slug: "cpp-range-temporary-lifetime",
    language: "C++", domain: "cpp", difficulty: "hard", questionType: "factual",
    question: "What happens to a temporary object created in the initializer of a C++ range-based for statement?",
    answer: "If it would otherwise be destroyed at the end of the initializer full-expression, its lifetime is extended to match the reference initialized by the range initializer.",
    keyFacts: ["The rule concerns a temporary in the range initializer.", "Its lifetime is extended when it would otherwise end after the initializer.", "It persists for the lifetime of the initialized reference."],
    needle: "temporary object is created in the for-range-initializer", preferredSection: "N5046",
  },
  {
    slug: "javascript-promise-all",
    language: "JavaScript", domain: "javascript", difficulty: "easy", questionType: "factual",
    question: "How does JavaScript Promise.all settle when given an iterable of promises?",
    answer: "It returns a promise fulfilled with an array of fulfillment values if all inputs fulfill, or rejected with the reason from the first input promise that rejects.",
    keyFacts: ["The result is a new promise.", "Successful values are returned as an array.", "The first rejection reason rejects the result."],
    needle: "fulfilled with an array of fulfillment values", preferredSection: "Promise.all",
  },
  {
    slug: "javascript-optional-chaining",
    language: "JavaScript", domain: "javascript", difficulty: "easy", questionType: "factual",
    question: "What does JavaScript optional chaining do when the value to access or invoke is nullish?",
    answer: "Optional chaining short-circuits the property access or function invocation when the target is null or undefined.",
    keyFacts: ["It applies to property access and function invocation.", "It short-circuits for nullish targets."],
    needle: "optional chaining, a property access and function invocation operator", preferredSection: "Introduction",
  },
  {
    slug: "kotlin-elvis-laziness",
    language: "Kotlin", domain: "kotlin", difficulty: "medium", questionType: "factual",
    question: "How does Kotlin's Elvis operator choose a value, and when is its right-hand expression evaluated?",
    answer: "The Elvis operator returns the right-hand expression only when the left-hand value is null. It is lazy, so the right side is not evaluated when the left side is non-null.",
    keyFacts: ["The operator tests the left side for null.", "The right side supplies the null fallback.", "The right side is evaluated lazily."],
    needle: "This operator is lazy", preferredSection: "8.12 Elvis",
  },
  {
    slug: "kotlin-data-generated-members",
    language: "Kotlin", domain: "kotlin", difficulty: "medium", questionType: "factual",
    question: "Which common functions does Kotlin generate for a data class to reduce boilerplate?",
    answer: "A data class receives data-oriented members including equals, hashCode, toString, a shallow-copying copy function, and component functions for its data properties.",
    keyFacts: ["equals, hashCode, and toString are generated.", "copy performs shallow copying.", "Component functions correspond to data properties."],
    needle: "data classes allow Kotlin to reduce the boilerplate", preferredSection: "4.1.2 Data class",
  },
  {
    slug: "bash-command-substitution-newlines",
    language: "Bash", domain: "bash", difficulty: "medium", questionType: "comparative",
    question: "How does Bash command substitution treat trailing and embedded newlines in captured output?",
    answer: "Ordinary command substitution deletes trailing newlines from the captured standard output. Embedded newlines are retained initially, although later word splitting may remove them.",
    keyFacts: ["Trailing newlines are deleted.", "Embedded newlines are not deleted by command substitution itself.", "Unquoted word splitting may subsequently remove embedded newlines."],
    needle: "with any trailing newlines deleted", preferredSection: "3.5.4 Command Substitution",
  },
  {
    slug: "bash-colon-parameter-expansion",
    language: "Bash", domain: "bash", difficulty: "medium", questionType: "comparative",
    question: "In Bash parameter expansion, how does including the colon in forms such as ${parameter:-word} change the test?",
    answer: "With the colon, Bash tests whether the parameter is unset or null. Without the colon, it tests only whether the parameter is unset.",
    keyFacts: ["Colon forms test both unset and null.", "Forms without the colon test only unset."],
    needle: "Omitting the colon results in a test only", preferredSection: "3.5.3 Shell Parameter Expansion",
  },
  {
    slug: "go-select-choice",
    language: "Go", domain: "go", difficulty: "medium", questionType: "factual",
    question: "What operation does a Go select statement choose among?",
    answer: "A select statement chooses which of a set of possible channel send or receive operations can proceed; a default clause may proceed when no communication case is ready.",
    keyFacts: ["Cases describe channel sends or receives.", "select chooses an operation that can proceed.", "A default clause is possible."],
    needle: "SelectStmt =", preferredSection: "Select statements",
    additionalNeedles: ["Otherwise, if there is a default case, that case is chosen"],
  },
  {
    slug: "go-interface-comparison",
    language: "Go", domain: "go", difficulty: "hard", questionType: "factual",
    question: "When are two Go interface values equal, and when can comparing them panic?",
    answer: "Two interface values are equal when their dynamic types are identical and their dynamic values are equal, or when both are nil. Comparison panics if identical dynamic types hold values of a non-comparable type.",
    keyFacts: ["Equality depends on identical dynamic types and equal dynamic values.", "Two nil interface values are equal.", "A non-comparable dynamic value can cause a run-time panic."],
    needle: "Two interface values are equal if they have identical dynamic types", preferredSection: "Language version",
    additionalNeedles: ["run-time panic"],
  },
  {
    slug: "python-generator-expression",
    language: "Python", domain: "python", difficulty: "easy", questionType: "comparative",
    question: "How does a Python generator expression differ from an equivalent list comprehension in syntax and memory behavior?",
    answer: "A generator expression uses parentheses rather than square brackets and produces values lazily, making it generally more memory-friendly than an equivalent list comprehension.",
    keyFacts: ["Generator expressions use parentheses.", "List comprehensions use square brackets.", "Generator expressions tend to use less memory."],
    needle: "parentheses instead of square brackets", preferredSection: "Generator Expressions",
  },
  {
    slug: "python-with-context-manager",
    language: "Python", domain: "python", difficulty: "medium", questionType: "procedural",
    question: "What protocol does Python's with statement use around execution of its block?",
    answer: "It evaluates a context manager, invokes its __enter__ method before the block, and uses __exit__ when leaving, encapsulating common try/finally-style setup and cleanup.",
    keyFacts: ["The context expression yields a context manager.", "__enter__ is invoked before the managed block.", "__exit__ handles leaving the context."],
    needle: "The context manager’s __enter__() method is invoked",
    additionalNeedles: ["The context manager’s __exit__() method is invoked"],
    preferredSection: "with statement",
  },
  {
    slug: "typescript-unknown-safety",
    language: "TypeScript", domain: "typescript", difficulty: "easy", questionType: "comparative",
    question: "Why is TypeScript unknown safer than any?",
    answer: "Both can represent any value, but operations on an unknown value are rejected until it is narrowed or otherwise checked, whereas any permits unchecked operations.",
    keyFacts: ["unknown can represent any value.", "Operations on unknown require validation or narrowing.", "any permits unchecked use."],
    needle: "unknown type represents any value", preferredSection: "Function Type Expressions",
  },
  {
    slug: "typescript-keyof-domain",
    language: "TypeScript", domain: "typescript", difficulty: "medium", questionType: "factual",
    question: "Which property-name categories can TypeScript's keyof operator represent?",
    answer: "For an object type, keyof can represent string, number, and symbol property names; keyof T is therefore a subtype of string | number | symbol.",
    keyFacts: ["keyof covers string-named properties.", "It also covers number-named properties.", "It also covers symbol-named properties."],
    needle: "keyof T for some type T is a subtype of string", preferredSection: "Support number and symbol",
  },
  {
    slug: "rust-slice-ownership",
    language: "Rust", domain: "rust", difficulty: "easy", questionType: "factual",
    question: "What does a Rust slice represent, and does it own the sequence it refers to?",
    answer: "A slice is a reference to a contiguous sequence of collection elements. Because it is a reference, it does not own the underlying data.",
    keyFacts: ["A slice references a contiguous sequence.", "A slice is a kind of reference.", "It does not have ownership."],
    needle: "Slices let you reference a contiguous sequence", preferredSection: "The Slice Type",
  },
  {
    slug: "rust-loop-break-value",
    language: "Rust", domain: "rust", difficulty: "medium", questionType: "procedural",
    question: "How can a Rust loop return a value to the surrounding code?",
    answer: "Place the desired value after the break expression; that value becomes the value returned by the loop and can be assigned or otherwise used.",
    keyFacts: ["break can carry a value.", "That value is returned from the loop.", "The returned value can be used by surrounding code."],
    needle: "value you want returned after the break expression", preferredSection: "Control Flow",
  },
];

const negatives: NegativeSpec[] = [
  ["react-zustand", "React", "react", "How does Zustand createStore configure a vanilla store and subscriptions?", "adjacent-technology", "The corpus documents React itself, not Zustand's store API.", ["Zustand createStore", "subscribeWithSelector"]],
  ["react-apollo", "React", "react", "How do Apollo Client cache policies control normalized GraphQL reads?", "adjacent-technology", "Apollo Client cache behavior is outside the React documentation corpus.", ["Apollo Client cache policy", "InMemoryCache typePolicies"]],
  ["c-libuv", "C", "c", "How does libuv's event loop order timer, poll, and check phases?", "adjacent-technology", "The C standard does not document libuv's event loop.", ["libuv event loop", "uv_run"]],
  ["c-openssl", "C", "c", "How should OpenSSL EVP contexts be initialized for authenticated encryption?", "adjacent-technology", "The C language standard does not cover the OpenSSL EVP library.", ["OpenSSL EVP", "EVP_EncryptInit_ex"]],
  ["java-spring-data", "Java", "java", "How does Spring Data JPA derive repository queries from method names?", "adjacent-technology", "The Java language specification does not document Spring Data JPA.", ["Spring Data JPA", "JpaRepository"]],
  ["java-micronaut", "Java", "java", "How does Micronaut perform compile-time dependency injection?", "adjacent-technology", "Micronaut framework internals are outside the Java language corpus.", ["Micronaut dependency injection", "@Inject Micronaut"]],
  ["postgres-timescale", "PostgreSQL", "postgresql", "How does TimescaleDB partition a hypertable into chunks?", "adjacent-technology", "The corpus contains core PostgreSQL documentation, not TimescaleDB.", ["TimescaleDB hypertable", "create_hypertable"]],
  ["postgres-postgis", "PostgreSQL", "postgresql", "How does PostGIS ST_Buffer handle geography values?", "adjacent-technology", "PostGIS function semantics are not part of the core PostgreSQL manual.", ["PostGIS ST_Buffer", "ST_Buffer geography"]],
  ["cpp-boost-asio", "C++", "cpp", "How does Boost.Asio io_context schedule completion handlers?", "adjacent-technology", "The C++ standard draft does not specify Boost.Asio.", ["Boost.Asio io_context", "io_context::run"]],
  ["cpp-qt-model", "C++", "cpp", "How does QAbstractItemModel encode parent-child indexes in Qt?", "adjacent-technology", "Qt model APIs are outside the C++ language standard.", ["QAbstractItemModel", "QModelIndex internalPointer"]],
  ["javascript-express", "JavaScript", "javascript", "In what order does Express execute application and router middleware?", "adjacent-technology", "ECMAScript specifies the language, not Express middleware behavior.", ["Express middleware", "express.Router"]],
  ["javascript-deno", "JavaScript", "javascript", "How do Deno permissions restrict network and file access?", "adjacent-technology", "Deno runtime permissions are outside the ECMAScript standard.", ["Deno permission", "--allow-net"]],
  ["kotlin-ktor", "Kotlin", "kotlin", "How are typed routes registered in Ktor?", "adjacent-technology", "The Kotlin language specification does not document Ktor.", ["Ktor routing", "RoutingCall"]],
  ["kotlin-serialization", "Kotlin", "kotlin", "How does kotlinx.serialization Json configure unknown-key handling?", "adjacent-technology", "The kotlinx.serialization library is not part of the language specification.", ["kotlinx.serialization Json", "ignoreUnknownKeys"]],
  ["bash-tmux", "Bash", "bash", "How are tmux prefix key bindings defined and reloaded?", "adjacent-technology", "The Bash manual does not document tmux configuration.", ["tmux key binding", "bind-key source-file"]],
  ["bash-systemd", "Bash", "bash", "How do systemd unit dependencies differ between Wants and Requires?", "adjacent-technology", "systemd unit semantics are outside the Bash language manual.", ["systemd unit dependency", "Requires= Wants="]],
  ["go-gin", "Go", "go", "How does Gin middleware pass control to later handlers?", "adjacent-technology", "The Go language specification does not cover the Gin framework.", ["Gin middleware", "c.Next()"]],
  ["go-grpc", "Go", "go", "How is a unary gRPC interceptor chained in grpc-go?", "adjacent-technology", "grpc-go middleware APIs are outside the Go language specification.", ["gRPC interceptor", "ChainUnaryInterceptor"]],
  ["python-pytorch", "Python", "python", "How does PyTorch autograd construct and release a computation graph?", "adjacent-technology", "The Python documentation corpus does not document PyTorch.", ["PyTorch autograd", "requires_grad"]],
  ["python-flask", "Python", "python", "How do Flask blueprints register routes and error handlers?", "adjacent-technology", "Flask framework behavior is outside the Python language and tutorial corpus.", ["Flask blueprint", "register_blueprint"]],
  ["typescript-trpc", "TypeScript", "typescript", "How does a tRPC router infer client procedure types?", "adjacent-technology", "The TypeScript handbook does not document tRPC.", ["tRPC router", "initTRPC"]],
  ["typescript-typeorm", "TypeScript", "typescript", "How do TypeORM entity decorators map relations?", "adjacent-technology", "TypeORM mapping behavior is outside the TypeScript language handbook.", ["TypeORM entity decorator", "@ManyToOne"]],
  ["rust-actix", "Rust", "rust", "How do Actix Web extractors reject malformed request payloads?", "adjacent-technology", "The Rust book does not document Actix Web.", ["Actix Web extractor", "FromRequest actix_web"]],
  ["rust-rayon", "Rust", "rust", "How does Rayon split work across parallel iterators?", "adjacent-technology", "Rayon's scheduling and iterator APIs are outside the Rust book.", ["Rayon parallel iterator", "ParallelIterator drive_unindexed"]],
].map(([slug, language, domain, question, category, refusalReason, probes]) => ({
  slug, language, domain, question, category, refusalReason, probes,
} as NegativeSpec));

async function main() {
  const chunks = JSON.parse(await fs.readFile(path.join(root, chunksFile), "utf8")) as DocumentationChunk[];
  const cases: ConfirmatoryCase[] = [];
  for (const spec of positives) {
    const evidenceChunks = [spec.needle, ...(spec.additionalNeedles ?? [])].map((needle) => selectChunk(chunks, spec, needle));
    cases.push({
      id: `confirm-v1-${spec.slug}`,
      status: "source-verified",
      language: spec.language,
      domain: spec.domain,
      question: spec.question,
      answerability: "answerable",
      difficulty: spec.difficulty,
      questionType: spec.questionType,
      expected: { answer: spec.answer, keyFacts: spec.keyFacts },
      evidence: evidenceChunks.map((chunk) => ({
        sourceId: chunk.sourceId,
        sourceUrl: chunk.sourceUrl,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        section: chunk.section,
        note: `Frozen evidence chunk ${chunk.id}.`,
      })),
      evidencePacket: evidenceChunks.map((chunk) => ({
        chunkId: chunk.id,
        sourceId: chunk.sourceId ?? null,
        sourceUrl: chunk.sourceUrl,
        title: chunk.title,
        section: chunk.section,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        excerpt: chunk.content,
      })),
      authoredBy: "structured benchmark drafting workflow",
      verifiedBy: "deterministic corpus evidence resolution",
      verifiedAt: createdAt,
      notes: "Requires explicit human confirmation before test locking.",
    });
  }

  for (const spec of negatives) {
    const probeResults = spec.probes.map((text) => ({
      text,
      matches: chunks.filter((chunk) => chunk.content.toLowerCase().includes(text.toLowerCase())).length,
    }));
    if (probeResults.some((probe) => probe.matches !== 0)) {
      throw new Error(`Negative case ${spec.slug} has a non-zero absence probe: ${JSON.stringify(probeResults)}`);
    }
    cases.push({
      id: `confirm-v1-${spec.slug}`,
      status: "source-verified",
      language: spec.language,
      domain: spec.domain,
      question: spec.question,
      answerability: "unanswerable",
      difficulty: "hard",
      questionType: "unanswerable",
      expected: { keyFacts: [], refusalReason: spec.refusalReason },
      evidence: [],
      evidencePacket: [],
      negativeVerification: {
        category: spec.category,
        scopeBasis: spec.refusalReason,
        absenceProbes: spec.probes,
      },
      corpusCheck: { checkedChunkCount: chunks.length, probes: probeResults },
      authoredBy: "structured benchmark drafting workflow",
      verifiedBy: "deterministic full-corpus absence scan",
      verifiedAt: createdAt,
      notes: "Requires explicit human confirmation before test locking.",
    });
  }

  cases.sort((a, b) => a.language.localeCompare(b.language) || a.answerability.localeCompare(b.answerability) || a.id.localeCompare(b.id));
  validateCases(cases);

  const benchmark: ConfirmatoryBenchmark = {
    schemaVersion: 1,
    id: "retriq-confirmatory-programming-qa",
    version: "1.0.0-review",
    title: "Retriq confirmatory programming QA benchmark",
    description: "A fresh, balanced 48-case confirmatory test. It is intentionally non-executable until every label is independently confirmed by the thesis author.",
    createdAt,
    status: "awaiting-human-confirmation",
    testLocked: false,
    method: "Two answerable and two unanswerable cases per domain; answerable labels resolved to frozen corpus chunks; unanswerable labels checked by full-corpus phrase probes.",
    corpus: {
      chunksFile,
      chunkCount: chunks.length,
      manifests: ["docs/corpus/react-learn.json", "docs/corpus/programming-foundation.json"],
    },
    priorTestsExcluded: [
      "docs/experiments/baseline-final-test.v1.json",
      "docs/experiments/generation-final-test.v1.json",
      "docs/evaluation/golden-set.v4.json",
    ],
    counts: { total: 48, answerable: 24, unanswerable: 24, domains: 12 },
    cases,
  };
  await fs.writeFile(path.join(root, outputFile), `${JSON.stringify(benchmark, null, 2)}\n`);
  console.log(`Wrote ${outputFile}: ${cases.length} cases, 24 answerable, 24 unanswerable.`);
}

function selectChunk(chunks: DocumentationChunk[], spec: PositiveSpec, needle: string) {
  const language = spec.corpusLanguage ?? spec.language;
  const candidates = chunks.filter((chunk) =>
    chunk.language?.toLowerCase() === language.toLowerCase()
    && chunk.content.toLowerCase().includes(needle.toLowerCase())
    && !chunk.section.toLowerCase().includes("table of contents")
    && !chunk.section.toLowerCase().includes("page contents"),
  );
  candidates.sort((a, b) => {
    const preferredA = spec.preferredSection && a.section.toLowerCase().includes(spec.preferredSection.toLowerCase()) ? 1 : 0;
    const preferredB = spec.preferredSection && b.section.toLowerCase().includes(spec.preferredSection.toLowerCase()) ? 1 : 0;
    return preferredB - preferredA || a.wordCount - b.wordCount;
  });
  const chunk = candidates[0];
  if (!chunk) throw new Error(`No evidence for ${spec.slug}: ${needle}`);
  return chunk;
}

function validateCases(cases: ConfirmatoryCase[]) {
  if (cases.length !== 48) throw new Error(`Expected 48 cases, found ${cases.length}.`);
  if (new Set(cases.map((item) => item.id)).size !== cases.length) throw new Error("Duplicate case IDs.");
  const answerable = cases.filter((item) => item.answerability === "answerable");
  if (answerable.length !== 24) throw new Error(`Expected 24 answerable cases, found ${answerable.length}.`);
  const byDomain = new Map<string, ConfirmatoryCase[]>();
  for (const item of cases) byDomain.set(item.domain, [...(byDomain.get(item.domain) ?? []), item]);
  if (byDomain.size !== 12) throw new Error(`Expected 12 domains, found ${byDomain.size}.`);
  for (const [domain, items] of byDomain) {
    const positiveCount = items.filter((item) => item.answerability === "answerable").length;
    const negativeCount = items.length - positiveCount;
    if (positiveCount !== 2 || negativeCount !== 2) throw new Error(`${domain}: expected 2+2, found ${positiveCount}+${negativeCount}.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
