# ABYX — BENCHMARK IMPLEMENTATION AUDIT

## 1. Catalog vs Execution Discrepancy

A strict audit of the benchmark infrastructure reveals a significant gap between defined benchmarks and actual executed tasks:

1. **`benchmarks/tasks/catalog.json`**:
   - Defines **275** granular task specifications across 12 categories (A through L).
   - Format follows structured schemas with difficulty ratings, inputs, and expected outputs.
2. **`benchmarks/reports/TASK_LEVEL_RESULTS.json`**:
   - Lists all **275** tasks from the catalog.
   - **Actual Execution Status:** **0 of 275 tasks were executed**.
   - Every single task in the file records:
     ```json
     "status": "not_run",
     "score": null,
     "attemptCount": 0,
     "verification": "not_run",
     "evidence": [],
     "notes": "No live Abyx agent run was executed in this benchmark pass."
     ```
3. **`benchmarks/tasks/benchmark_tasks.json`**:
   - Contains a smaller subset of **44** tasks.
4. **`benchmarks/reports/benchmark_results.json`**:
   - Records only **15** executed tasks run via `benchmark_runner.cjs` (`15/15 passed`).
   - 29 tasks in `benchmark_tasks.json` and 260 tasks in `catalog.json` were never executed.

---

## 2. Benchmark Audit Checklist (Section 8)

| Criterion | Requirement | Finding | Evidence | Status |
|---|---|---|---|---|
| 1. Task Volume | $\ge 100$ distinct tasks | 275 tasks defined in catalog; 44 tasks in runner file | `catalog.json` (275 tasks), `benchmark_tasks.json` (44 tasks) | **VERIFIED** (Definition) |
| 2. Task Structure | Task / Context / Format | Followed across all defined tasks | Inspect task objects | **VERIFIED** |
| 3. Actual Execution | Real task execution through harness | Only 15 tasks executed; 275 tasks marked `"not_run"` | `TASK_LEVEL_RESULTS.json: "status": "not_run"` across all 275 items | **PARTIAL** |
| 4. Independent Validation | Automated validators checking results | Runner validates file sizes, JSON schemas, HTTP codes | `benchmarks/evaluators/` scripts | **VERIFIED** |
| 5. Evidence Match | Recorded scores backed by artifacts | 15 passing results match actual generated scratch files | `benchmarks/scratch/` files present | **VERIFIED** |
| 6. Separation of Tiers | Local and cloud evaluated independently | Local model evaluated; cloud evaluations skipped | No API keys set for cloud providers | **PARTIAL** |
| 7. Reproducibility | Deterministic replay of benchmark run | `node benchmark_runner.cjs` replays the 15 tests cleanly | Runner executed in 3.4 seconds | **VERIFIED** |

**Conclusion:** The benchmark catalog and structure exist in high fidelity (275 defined tasks), but the full 100+ task execution pass was **never actually run against the agent runtime**.
