import fs from "node:fs/promises";
import path from "node:path";

import type {
  GoldenCase,
  GoldenNegativeCategory,
  GoldenQuestionType,
  GoldenSet,
  GoldenSetSplit,
} from "../src/lib/rag/golden-set";

const reviewedAt = "2026-07-16T00:00:00.000Z";
const inputDataset = "docs/evaluation/golden-set.v2.json";
const inputSplit = "docs/evaluation/golden-set-splits.v2.json";

async function main() {
  const outputPath = path.resolve(readArg("--output", "docs/evaluation/golden-set.v3.json"));
  const splitPath = path.resolve(readArg("--split", "docs/evaluation/golden-set-splits.v3.json"));
  const checklistPath = path.resolve(readArg("--checklist", "docs/evaluation/HUMAN_REVIEW_CHECKLIST_V3.md"));
  const original = JSON.parse(await fs.readFile(path.resolve(inputDataset), "utf8")) as GoldenSet;
  const previousSplit = JSON.parse(await fs.readFile(path.resolve(inputSplit), "utf8")) as GoldenSetSplit;
  const positives = answerableCases().map(provisionalApproval);
  const negatives = negativeCases().map(provisionalApproval);
  const newTestPositiveIds = new Set([
    "cpp-range-for-lookup-001",
    "javascript-promise-any-001",
    "kotlin-elvis-lazy-001",
    "bash-pipefail-status-001",
    "go-defer-order-001",
    "go-method-set-pointer-001",
  ]);
  const newTestNegativeIds = new Set([
    "cpp-qt-signals-001",
    "javascript-node-fs-001",
    "kotlin-compose-effects-001",
    "python-numpy-broadcast-001",
    "rust-tokio-tasks-001",
    "go-client-kubernetes-001",
  ]);
  const dataset: GoldenSet = {
    ...original,
    version: "3.0.0-expanded-provisional-review",
    title: "Retriq programming documentation golden set - expanded provisional review",
    description: "Sixty-case balanced retrieval benchmark expanded with source-grounded questions for previously untested corpus documents and hard negatives for adjacent technologies. Operational human approval remains pending independent confirmation.",
    createdAt: reviewedAt,
    cases: [...original.cases, ...positives, ...negatives],
  };
  const newValidationIds = [...positives, ...negatives]
    .filter((item) => !newTestPositiveIds.has(item.id) && !newTestNegativeIds.has(item.id))
    .map((item) => item.id);
  const newTestIds = [...positives, ...negatives]
    .filter((item) => newTestPositiveIds.has(item.id) || newTestNegativeIds.has(item.id))
    .map((item) => item.id);
  const split: GoldenSetSplit = {
    schemaVersion: 1,
    id: "retriq-programming-qa-validation-test-v3",
    version: "3.0.0",
    datasetId: dataset.id,
    datasetVersion: dataset.version,
    createdAt: reviewedAt,
    method: "Preserve all v2 assignments, including the six-case locked test. Add a stratified 18-case validation increment and a balanced 12-case locked test increment. No v3 test case is used during benchmark construction.",
    seed: "retriq-thesis-split-v3-expansion",
    eligibleStatuses: ["human-approved"],
    stratifyBy: ["answerability", "difficulty", "language/domain", "negative category", "source family"],
    testLocked: true,
    validationCaseIds: [...previousSplit.validationCaseIds, ...newValidationIds],
    testCaseIds: [...previousSplit.testCaseIds, ...newTestIds],
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`);
  await fs.writeFile(splitPath, `${JSON.stringify(split, null, 2)}\n`);
  await fs.writeFile(checklistPath, renderChecklist(dataset, split));
  console.log(`BUILT ${dataset.id}@${dataset.version}: ${dataset.cases.length} cases.`);
  console.log(`Locked test: ${split.testCaseIds.length}; validation: ${split.validationCaseIds.length}.`);
}

function answerableCases(): GoldenCase[] {
  return [
    answerable("cpp-range-for-lookup-001", "C++", "iteration", "How does a C++ range-based for loop determine its begin and end expressions for arrays, class types, and other ranges?", "multi-hop", "hard",
      "For an array, begin and end are the array and array plus its bound. For a class range with both begin and end members found in class scope, the loop uses range.begin() and range.end(). Otherwise it calls begin(range) and end(range) using argument-dependent lookup only.",
      ["Arrays use range and range plus the array bound.", "A class with both member names uses range.begin() and range.end().", "Other ranges use begin(range) and end(range) with argument-dependent lookup, not ordinary unqualified lookup."],
      "cpp26-working-draft-n5046", 206, 207, "8.6.5 The range-based for statement"),
    answerable("cpp-move-constructor-001", "C++", "object-lifetime", "What parameter form makes a non-template C++ constructor a move constructor?", "factual", "medium",
      "Its first parameter must be an rvalue reference to the class type, possibly cv-qualified (X&&, const X&&, volatile X&&, or const volatile X&&), and any remaining parameters must have default arguments.",
      ["The first parameter is an rvalue reference to X.", "The referenced X may be cv-qualified.", "Any additional parameters require default arguments."],
      "cpp26-working-draft-n5046", 331, 331, "11.4.5.3 Copy/move constructors"),
    answerable("cpp-structured-binding-size-001", "C++", "declarations", "Without a structured binding pack, what constraint applies to the number of names in a C++ structured binding declaration?", "factual", "medium",
      "The number of identifiers must equal the structured binding size of the initializer type.",
      ["The identifier count must equal the structured binding size.", "The different rule allowing fewer non-pack elements applies only when a structured binding pack exists."],
      "cpp26-working-draft-n5046", 280, 280, "9.7 Structured binding declarations"),
    answerable("javascript-promise-all-001", "JavaScript", "promises", "How do Promise.all and Promise.allSettled differ when one input promise rejects?", "comparative", "medium",
      "Promise.all rejects with the reason of the first input promise that rejects. Promise.allSettled instead waits until every input settles and fulfills with an array describing each outcome.",
      ["Promise.all rejects on the first rejection.", "Promise.allSettled waits for all inputs to settle.", "Promise.allSettled fulfills with state snapshots for all inputs."],
      "ecmascript-2026-ecma-262", 771, 773, "27.2.4.1-27.2.4.2 Promise combinators"),
    answerable("javascript-promise-any-001", "JavaScript", "promises", "When does Promise.any reject, and what does its rejection contain?", "factual", "medium",
      "Promise.any rejects only if all input promises reject, and the rejection is an AggregateError containing their rejection reasons; otherwise it fulfills with the first fulfillment.",
      ["It fulfills with the first fulfilled input.", "It rejects only when every input rejects.", "The rejection is an AggregateError holding the rejection reasons."],
      "ecmascript-2026-ecma-262", 774, 775, "27.2.4.3 Promise.any"),
    answerable("javascript-array-filter-holes-001", "JavaScript", "arrays", "Does Array.prototype.filter call its callback for missing array elements or elements appended after filtering starts?", "factual", "medium",
      "No. filter calls the callback only for elements that exist, and the range it processes is fixed before the first callback, so later appended elements are not visited.",
      ["Missing elements do not trigger the callback.", "The processed range is fixed before the first callback.", "Elements appended after filtering starts are not visited."],
      "ecmascript-2026-ecma-262", 623, 624, "23.1.3.8 Array.prototype.filter"),
    answerable("kotlin-smart-cast-001", "Kotlin", "type-system", "What problem do Kotlin smart casts solve?", "factual", "medium",
      "Smart casts provide flow-sensitive typing: when data-flow analysis guarantees a runtime type, the compiler refines the expression's compile-time type so an explicit cast is unnecessary.",
      ["Smart casts are a form of flow-sensitive typing.", "They rely on data-flow information.", "They avoid explicit casts when the runtime type is guaranteed."],
      "kotlin-language-specification", 273, 274, "14.1 Smart casts"),
    answerable("kotlin-elvis-lazy-001", "Kotlin", "null-safety", "How does Kotlin's Elvis operator evaluate its two operands?", "factual", "medium",
      "The Elvis operator returns the left operand when it is not null; otherwise it evaluates and returns the right operand. The right operand is lazy and is not evaluated when the left operand is non-null.",
      ["The operator tests whether the left operand is null.", "The right operand is evaluated only for a null left operand.", "A non-null left operand is returned directly."],
      "kotlin-language-specification", 186, 186, "8.12 Elvis operator expressions"),
    answerable("kotlin-not-null-assertion-001", "Kotlin", "null-safety", "What happens when Kotlin's not-null assertion operator is applied to a nullable expression?", "factual", "medium",
      "The expression is evaluated; if its result is null, a runtime exception is thrown. Otherwise that value is returned with a non-nullable type.",
      ["A null result causes a runtime exception.", "A non-null result is returned.", "The resulting type is non-nullable."],
      "kotlin-language-specification", 192, 192, "8.19 Not-null assertion expressions"),
    answerable("bash-pipeline-stderr-001", "Bash", "pipelines", "What does the Bash |& pipeline operator do, and when is its implicit redirection applied?", "factual", "medium",
      "It connects both standard output and standard error of the left command to the next command's standard input. It is shorthand for 2>&1 |, and the implicit stderr redirection occurs after redirections explicitly written for the command.",
      ["|& pipes both stdout and stderr.", "It is shorthand for 2>&1 |.", "Its implicit redirection is applied after explicit command redirections."],
      "gnu-bash-5-3-reference-manual", 16, 16, "3.2.3 Pipelines"),
    answerable("bash-pipefail-status-001", "Bash", "pipelines", "How does enabling pipefail change a Bash pipeline's exit status?", "comparative", "medium",
      "Normally a pipeline has the status of its last command. With pipefail enabled, it has the status of the rightmost command that exited non-zero, or zero if every command succeeded.",
      ["Without pipefail, the last command determines status.", "With pipefail, the rightmost non-zero status is used.", "The status is zero if all commands succeed."],
      "gnu-bash-5-3-reference-manual", 16, 16, "3.2.3 Pipelines"),
    answerable("bash-heredoc-quoted-delimiter-001", "Bash", "redirection", "How does quoting a Bash here-document delimiter affect expansion in the body?", "factual", "medium",
      "If any part of the delimiter word is quoted, the delimiter is formed after quote removal and the here-document lines are not subjected to parameter expansion, command substitution, or arithmetic expansion.",
      ["Quote removal determines the delimiter.", "A quoted delimiter disables parameter expansion in the body.", "It also disables command substitution and arithmetic expansion."],
      "gnu-bash-5-3-reference-manual", 50, 50, "3.6.6 Here Documents"),
    answerableWeb("go-defer-order-001", "Go", "control-flow", "When are arguments to a deferred Go call evaluated, and in what order are multiple deferred calls invoked?", "multi-hop", "medium",
      "The function value and arguments are evaluated and saved when the defer statement executes. The calls themselves run immediately before the surrounding function returns, in reverse order.",
      ["Function value and arguments are evaluated at the defer statement.", "Execution is delayed until the surrounding function returns or panics.", "Deferred calls run in reverse order."],
      "go-language-specification", "Defer statements"),
    answerableWeb("go-method-set-pointer-001", "Go", "type-system", "How do the method sets of a defined Go type T and a pointer *T differ?", "comparative", "medium",
      "The method set of T contains methods declared with receiver T. The method set of *T contains methods declared with receiver T or *T.",
      ["T includes methods with receiver T.", "*T includes methods with receiver T.", "*T also includes methods with receiver *T."],
      "go-language-specification", "Method sets"),
    answerableWeb("go-recover-conditions-001", "Go", "panic-recovery", "When does Go's recover stop a panicking sequence, and when does it return nil?", "multi-hop", "hard",
      "A direct recover call in a deferred function can obtain the panic value; if that deferred function returns normally without starting another panic, the sequence stops. recover returns nil when the goroutine is not panicking or when it was not called directly by a deferred function.",
      ["recover must be called directly by a deferred function to recover a panic.", "Normal return from that deferred function stops the panicking sequence.", "recover returns nil outside a panic or when not called directly by a deferred function."],
      "go-language-specification", "Handling panics"),
  ];
}

function negativeCases(): GoldenCase[] {
  return [
    negative("cpp-qt-signals-001", "C++", "How do QObject::connect and Qt::QueuedConnection deliver a signal across threads?", "adjacent-technology", "The corpus contains the C++ language working draft, not the Qt framework manuals.", ["QObject::connect", "Qt::QueuedConnection", "Q_OBJECT"]),
    negative("cpp-cmake-targets-001", "C++", "How should target_link_libraries and find_package be combined for imported CMake targets?", "adjacent-technology", "The corpus contains C++ language documentation, not CMake documentation.", ["target_link_libraries", "CMAKE_PREFIX_PATH", "find_package(CONFIG"]),
    negative("javascript-node-fs-001", "JavaScript", "How do fs.promises.readFile and AbortSignal interact in Node.js?", "adjacent-technology", "The corpus contains the ECMAScript language specification, not the Node.js runtime API.", ["fs.promises.readFile", "node:fs/promises", "Buffer.allocUnsafe"]),
    negative("javascript-express-router-001", "JavaScript", "How does express.Router merge route parameters from a parent router?", "adjacent-technology", "The corpus contains ECMAScript and React material, not Express framework documentation.", ["express.urlencoded", "Router({ mergeParams", "req.app.locals"]),
    negative("kotlin-compose-effects-001", "Kotlin", "When should Jetpack Compose use LaunchedEffect instead of rememberCoroutineScope?", "adjacent-technology", "The corpus contains the Kotlin language specification, not Jetpack Compose documentation.", ["LaunchedEffect", "rememberCoroutineScope", "rememberSaveable"]),
    negative("kotlin-gradle-plugin-001", "Kotlin", "How does the Kotlin Gradle plugin configure jvmToolchain and compilerOptions?", "adjacent-technology", "The corpus contains the Kotlin language specification, not Gradle plugin documentation.", ["jvmToolchain", "KotlinCompile", "compilerOptions.freeCompilerArgs"]),
    negative("bash-zsh-completion-001", "Bash", "How do zstyle and compinit configure completion matching in Zsh?", "adjacent-technology", "The corpus contains the GNU Bash manual, not Zsh documentation.", ["zstyle", "compinit", "matcher-list"]),
    negative("bash-fish-argparse-001", "Bash", "How does Fish shell argparse expose parsed options to a function?", "adjacent-technology", "The corpus contains the GNU Bash manual, not Fish shell documentation.", ["__fish_seen_subcommand_from", "fish_opt", "argparse --ignore-unknown"]),
    negative("python-numpy-broadcast-001", "Python", "How do numpy.broadcast_to and numpy.einsum apply NumPy broadcasting rules?", "adjacent-technology", "The corpus does not contain NumPy API documentation.", ["numpy.broadcast_to", "numpy.einsum", "numpy.ndarray"]),
    negative("python-fastapi-dependencies-001", "Python", "How does FastAPI cache nested Depends dependencies within one request?", "adjacent-technology", "The corpus does not contain FastAPI documentation.", ["fastapi.Depends", "fastapi.APIRouter", "dependency_overrides"]),
    negative("typescript-angular-onpush-001", "TypeScript", "When does Angular's ChangeDetectionStrategy.OnPush re-check a component?", "adjacent-technology", "The corpus contains TypeScript handbook material, not Angular documentation.", ["ChangeDetectionStrategy.OnPush", "ChangeDetectorRef.markForCheck", "provideZoneChangeDetection"]),
    negative("typescript-nestjs-guards-001", "TypeScript", "How does a NestJS guard use ExecutionContext to inspect route metadata?", "adjacent-technology", "The corpus contains TypeScript handbook material, not NestJS documentation.", ["ExecutionContext", "CanActivate", "Reflector.getAllAndOverride"]),
    negative("rust-tokio-tasks-001", "Rust", "How do tokio::spawn and JoinSet propagate task cancellation and panics?", "adjacent-technology", "The corpus contains Rust language/book entry pages, not Tokio API documentation.", ["tokio::spawn", "JoinSet", "JoinError::is_panic"]),
    negative("rust-serde-custom-001", "Rust", "How does Serde's deserialize_with attribute customize field deserialization?", "adjacent-technology", "The corpus does not contain Serde documentation.", ["deserialize_with", "serde_json::from_str", "derive(Serialize"]),
    negative("go-client-kubernetes-001", "Go", "How does client-go build a Kubernetes client with rest.InClusterConfig and a shared informer?", "adjacent-technology", "The corpus contains the Go language specification, not Kubernetes client-go documentation.", ["rest.InClusterConfig", "kubernetes.NewForConfig", "SharedIndexInformer"]),
  ];
}

function answerable(id: string, language: string, domain: string, question: string, questionType: GoldenQuestionType, difficulty: "medium" | "hard", answer: string, keyFacts: string[], sourceId: string, pageStart: number, pageEnd: number, section: string): GoldenCase {
  return baseAnswerable(id, language, domain, question, questionType, difficulty, answer, keyFacts, [{ sourceId, pageStart, pageEnd, section }]);
}

function answerableWeb(id: string, language: string, domain: string, question: string, questionType: GoldenQuestionType, difficulty: "medium" | "hard", answer: string, keyFacts: string[], sourceId: string, section: string): GoldenCase {
  return baseAnswerable(id, language, domain, question, questionType, difficulty, answer, keyFacts, [{ sourceId, section }]);
}

function baseAnswerable(id: string, language: string, domain: string, question: string, questionType: GoldenQuestionType, difficulty: "medium" | "hard", answer: string, keyFacts: string[], evidence: GoldenCase["evidence"]): GoldenCase {
  return { id, status: "source-verified", language, domain, question, answerability: "answerable", difficulty, questionType, expected: { answer, keyFacts }, evidence, tags: [language.toLowerCase(), domain, "expanded-v3"], notes: "Verified against the locally extracted corpus; independent user confirmation pending.", authoredBy: "codex-assisted-curation", verifiedBy: "local-corpus-extraction-inspection", verifiedAt: reviewedAt };
}

function negative(id: string, language: string, question: string, category: GoldenNegativeCategory, scopeBasis: string, absenceProbes: string[]): GoldenCase {
  return { id, status: "source-verified", language, domain: "adjacent-technology", question, answerability: "unanswerable", difficulty: "hard", questionType: "unanswerable", expected: { keyFacts: [], refusalReason: scopeBasis }, evidence: [], tags: ["negative", "hard-negative", category, language.toLowerCase(), "expanded-v3"], negativeVerification: { category, scopeBasis, absenceProbes }, authoredBy: "codex-assisted-curation", verifiedBy: "corpus-scope-and-absence-probe", verifiedAt: reviewedAt };
}

function provisionalApproval(item: GoldenCase): GoldenCase {
  return { ...item, status: "human-approved", approval: { state: "pending-confirmation", approvedBy: "user-delegated-ai-review", approvedAt: reviewedAt, basis: "Operational approval requested by the user after source/corpus verification; the user will independently confirm the case before final thesis reporting." } };
}

function renderChecklist(dataset: GoldenSet, split: GoldenSetSplit) {
  const testIds = new Set(split.testCaseIds);
  return `# Human review checklist - benchmark v3\n\nAll 60 cases are operationally marked \`human-approved\`, while \`approval.state=pending-confirmation\` preserves the fact that independent review is outstanding. Do not execute the locked 18-case test before confirming its cases and freezing the evaluation protocol.\n\n## Coverage note\n\nThe 15 answerable cases added when v3 was frozen cover C++, ECMAScript, Kotlin, Bash, and Go. At that time the Python, TypeScript, and Rust acquisitions contained mostly index content, so v3 deliberately made no unsupported positive claims for them. Multipage HTML snapshots have since repaired that corpus limitation; positive cases for these languages belong in a separately versioned benchmark update so the locked v3 test is not silently changed.\n\n| Confirm | Case | Split | Answerability | Language | Evidence or negative basis |\n|---|---|---|---|---|---|\n${dataset.cases.map((item) => `| [ ] | \`${item.id}\` | ${testIds.has(item.id) ? "test" : "validation"} | ${item.answerability} | ${item.language} | ${item.answerability === "answerable" ? item.evidence.map((evidence) => `${evidence.sourceId ?? evidence.sourceUrl}${evidence.pageStart ? ` p.${evidence.pageStart}-${evidence.pageEnd}` : " (HTML)"}`).join("; ") : item.negativeVerification?.scopeBasis} |`).join("\n")}\n`;
}

function readArg(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
