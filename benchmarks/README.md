# Abyx Agent Harness Benchmark

This package is a separate benchmark workspace; it does not edit Abyx application code or user data. The task catalog contains 275 scenarios: 100 basic, 100 intermediate, 50 advanced, and 25 end-to-end workflows. Scenarios were selected from the supplied specification and given an explicit evidence requirement. The end-to-end scenarios have separate workflow plans and acceptance checks.

## Integrity and current status

The first benchmark pass is an implementation inventory and a safe test-suite baseline. **None of the 275 agent tasks has been executed through a live Abyx run yet.** `results/latest-task-results.json` therefore marks them `not_run`; blank scores do not mean zero and do not mean pass. No overall benchmark score is reported until task evidence is collected.

The production application must be launched separately against disposable data and workspace directories. The runner checks that it talks only to loopback, the server's approved root exactly matches the disposable workspace, and the directory name starts with `abyx-benchmark-`. It requires an explicit model and the `ABYX_BENCHMARK_DISPOSABLE_OK=1` acknowledgement. Keep the workspace outside the repository. Never point it at the user's normal app data, home directory, source checkout, or a real project.

The runner is sequential, captures redacted SSE event traces and authorization summaries, applies wall-clock limits, and keeps prior raw runs. It does not auto-approve tools, choose fallback models, infer task success from model text, or assign manual scores. The current task verifiers are review plans, not an automatic task-specific oracle; mark results as verified only after an independent artifact or trace check.

## Reproducing a task run

1. Create a fresh disposable directory such as `%TEMP%\abyx-benchmark-<run-id>` with separate `workspace` and `data` subdirectories.
2. Start a local Abyx server against those paths using `ABYX_WORKSPACE_DIR=<workspace>` and `ABYX_DATA_DIR=<data>`, and a free loopback port. Do not use the normal app port if it belongs to a running Abyx installation.
3. Confirm `GET /api/agent/policy` reports exactly that disposable workspace as its approved root. The runner refuses a mismatch.
4. In PowerShell, set `ABYX_BENCHMARK_DISPOSABLE_OK=1`, `ABYX_BENCHMARK_WORKSPACE=<workspace>`, and `ABYX_BENCHMARK_URL=http://127.0.0.1:<port>`. Select the provider/model explicitly; do not allow automatic fallback for provider-comparison runs.
5. Preview task selection with `node benchmarks/runners/run-agent-benchmark.cjs --category D --dry-run`.
6. Execute one explicitly selected task with `node benchmarks/runners/run-agent-benchmark.cjs --task D-001 --model <exact-model-id>`. Review every approval in the UI. Run repeats as separate attempts; do not overwrite raw records.
7. Perform the independent checks in the task record and write reviewer scores to a separate evaluation file. This runner leaves `score` null.

The installed build, cloud credentials, local model endpoint, network policy, and hardware must be explicitly configured by the operator. A provider or UI task is not considered passed if the feature is unavailable or no independent evidence exists.

## Contents

- `tasks/catalog.json`: versioned task definitions and scoring weights.
- `datasets/`: synthetic, non-personal fixtures only.
- `runners/`: catalog importer and sequential loopback SSE runner.
- `evaluators/`: independent deterministic checks for synthetic artifacts.
- `results/`: append-only run summaries and raw traces; do not commit secrets or real user data.
- `reports/`: required Markdown/CSV/JSON benchmark deliverables and measured-only charts.

## Scores

Each task uses the supplied 100-point rubric: correctness 35, completion 20, tool/skill use 15, verification 10, instruction compliance 10, efficiency 5, error handling 5. Unrun and unsupported tasks are excluded from numeric averages and reported separately. Category, difficulty, first-attempt, eventual, median, p95, failure, recovery, verification, and resource measures require actual attempts and are not imputed.

## Current reports

The current report package is a readiness baseline, not a completed agent-task benchmark. All 275 task records are `not_run` with null scores. The report set is in `reports/`, including the executive, inventory, category, task-level CSV/JSON, skill, coding, file/document, multi-step, security, performance, reliability, competitive, failure, roadmap and final reports. Raw run ledger is `results/agent-runs.json`; no live run is present.

Regenerate the static reports and unrun task ledger with:

```powershell
node benchmarks/runners/generate-reports.cjs
```

The 5 benchmark-package tests validate catalog shape, fixture integrity, runner safety guards and deterministic fixture oracles. The current project regression runs recorded in the final report are separate from those benchmark-package tests.
