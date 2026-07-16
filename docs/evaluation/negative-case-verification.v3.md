# Negative-case corpus verification

- Dataset: `retriq-programming-qa@3.0.0-expanded-provisional-review`
- Corpus snapshot: `673fbea077a5913a899bbe7b5b8a272c638901d02502e43bc37bbe122181dff6`
- Negative cases: **30**
- Absence probes: **90**
- Unexpected probe matches: **0**

| Case | Category | Probes | Result |
|---|---|---|---|
| react-out-of-scope-001 | out-of-corpus | `@NgModule`, `providers: [`, `angular.io/guide/ngmodules` | no exact match |
| csharp-linq-iqueryable-001 | out-of-corpus | `IQueryable`, `System.Linq`, `Expression<Func` | no exact match |
| swift-sendable-actors-001 | out-of-corpus | `Sendable`, `actor-isolated`, `nonisolated` | no exact match |
| ruby-activerecord-callbacks-001 | out-of-corpus | `ActiveRecord::Callbacks`, `before_validation`, `after_commit` | no exact match |
| haskell-stm-retry-001 | out-of-corpus | `Control.Concurrent.STM`, `retry :: STM`, `orElse :: STM` | no exact match |
| java-android-activity-lifecycle-001 | adjacent-technology | `android.app.Activity`, `onPause()`, `onStop()` | no exact match |
| react-native-flatlist-001 | adjacent-technology | `FlatList`, `getItemLayout`, `VirtualizedList` | no exact match |
| python-django-atomic-001 | adjacent-technology | `transaction.atomic`, `TransactionManagementError`, `ATOMIC_REQUESTS` | no exact match |
| postgresql-rds-parameter-groups-001 | vendor-specific | `DB parameter group`, `rds.force_ssl`, `pending-reboot` | no exact match |
| c-msvc-sal-annotations-001 | vendor-specific | `_In_reads_`, `_Out_writes_`, `sal.h` | no exact match |
| java-se-27-value-classes-001 | unsupported-version | `Java SE 27`, `value record class`, `ACC_IDENTITY` | no exact match |
| postgresql-19-release-001 | unsupported-version | `PostgreSQL 19`, `Release 19`, `19.0` | no exact match |
| c-cuda-unified-memory-001 | adjacent-technology | `cudaMemPrefetchAsync`, `cudaMallocManaged`, `cudaMemAdvise` | no exact match |
| java-hibernate-lazyinit-001 | adjacent-technology | `LazyInitializationException`, `Hibernate.initialize`, `FetchType.LAZY` | no exact match |
| postgresql-pg-partman-retention-001 | adjacent-technology | `pg_partman`, `create_parent`, `retention_keep_table` | no exact match |
| cpp-qt-signals-001 | adjacent-technology | `QObject::connect`, `Qt::QueuedConnection`, `Q_OBJECT` | no exact match |
| cpp-cmake-targets-001 | adjacent-technology | `target_link_libraries`, `CMAKE_PREFIX_PATH`, `find_package(CONFIG` | no exact match |
| javascript-node-fs-001 | adjacent-technology | `fs.promises.readFile`, `node:fs/promises`, `Buffer.allocUnsafe` | no exact match |
| javascript-express-router-001 | adjacent-technology | `express.urlencoded`, `Router({ mergeParams`, `req.app.locals` | no exact match |
| kotlin-compose-effects-001 | adjacent-technology | `LaunchedEffect`, `rememberCoroutineScope`, `rememberSaveable` | no exact match |
| kotlin-gradle-plugin-001 | adjacent-technology | `jvmToolchain`, `KotlinCompile`, `compilerOptions.freeCompilerArgs` | no exact match |
| bash-zsh-completion-001 | adjacent-technology | `zstyle`, `compinit`, `matcher-list` | no exact match |
| bash-fish-argparse-001 | adjacent-technology | `__fish_seen_subcommand_from`, `fish_opt`, `argparse --ignore-unknown` | no exact match |
| python-numpy-broadcast-001 | adjacent-technology | `numpy.broadcast_to`, `numpy.einsum`, `numpy.ndarray` | no exact match |
| python-fastapi-dependencies-001 | adjacent-technology | `fastapi.Depends`, `fastapi.APIRouter`, `dependency_overrides` | no exact match |
| typescript-angular-onpush-001 | adjacent-technology | `ChangeDetectionStrategy.OnPush`, `ChangeDetectorRef.markForCheck`, `provideZoneChangeDetection` | no exact match |
| typescript-nestjs-guards-001 | adjacent-technology | `ExecutionContext`, `CanActivate`, `Reflector.getAllAndOverride` | no exact match |
| rust-tokio-tasks-001 | adjacent-technology | `tokio::spawn`, `JoinSet`, `JoinError::is_panic` | no exact match |
| rust-serde-custom-001 | adjacent-technology | `deserialize_with`, `serde_json::from_str`, `derive(Serialize` | no exact match |
| go-client-kubernetes-001 | adjacent-technology | `rest.InClusterConfig`, `kubernetes.NewForConfig`, `SharedIndexInformer` | no exact match |

Exact-string absence is a reproducible sanity check, not semantic proof by itself. Source-manifest scope and the recorded scope basis remain the primary justification for classifying a question as unanswerable.
