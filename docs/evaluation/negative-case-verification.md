# Negative-case corpus verification

- Dataset: `retriq-programming-qa@1.2.0-negative-splits`
- Corpus snapshot: `ff8f396c788c2a7643fa3e340c7d627efcab4157266b51dcb7558a2933780b1c`
- Negative cases: **12**
- Absence probes: **36**
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

Exact-string absence is a reproducible sanity check, not semantic proof by itself. Source-manifest scope and the recorded scope basis remain the primary justification for classifying a question as unanswerable.
