# Negative-case corpus verification

- Dataset: `retriq-programming-qa@4.0.0-html-language-coverage`
- Corpus snapshot: `ca6e947cc62f572639ef1261b911d4834a17267c84b2844b0ed3e385c1e48864`
- Negative cases: **39**
- Absence probes: **117**
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
| postgresql-19-release-001 | unsupported-version | `PostgreSQL 19.0 release notes`, `PostgreSQL version 19 beta`, `Release 19 documentation` | no exact match |
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
| rust-serde-custom-001 | adjacent-technology | `serde(deserialize_with`, `serde::Deserializer`, `Serializer::serialize_struct` | no exact match |
| go-client-kubernetes-001 | adjacent-technology | `rest.InClusterConfig`, `kubernetes.NewForConfig`, `SharedIndexInformer` | no exact match |
| python-pandas-groupby-001 | adjacent-technology | `pandas.DataFrame.groupby`, `GroupBy.transform`, `pd.NamedAgg` | no exact match |
| python-sqlalchemy-async-001 | adjacent-technology | `sqlalchemy.ext.asyncio`, `AsyncSession`, `selectinload` | no exact match |
| python-celery-retry-001 | adjacent-technology | `Celery.task`, `apply_async`, `acks_late` | no exact match |
| typescript-deno-permissions-001 | adjacent-technology | `Deno.serve`, `Deno.permissions`, `npm: specifier` | no exact match |
| typescript-vite-glob-001 | adjacent-technology | `import.meta.glob`, `vite.config.ts`, `defineConfig` | no exact match |
| typescript-prisma-transaction-001 | adjacent-technology | `PrismaClient`, `$transaction`, `relationLoadStrategy` | no exact match |
| rust-axum-state-001 | adjacent-technology | `axum::Router`, `IntoResponse`, `State<AppState>` | no exact match |
| rust-bevy-query-001 | adjacent-technology | `derive(Component)`, `bevy_ecs`, `Query<(&Transform` | no exact match |
| rust-diesel-querydsl-001 | adjacent-technology | `diesel::table!`, `RunQueryDsl`, `QueryDsl` | no exact match |

Exact-string absence is a reproducible sanity check, not semantic proof by itself. Source-manifest scope and the recorded scope basis remain the primary justification for classifying a question as unanswerable.
