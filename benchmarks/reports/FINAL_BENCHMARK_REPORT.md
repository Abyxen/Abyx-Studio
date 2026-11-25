# Final Benchmark Report

## Result

This is a **benchmark readiness and source/test baseline**, not a completed comparative agent benchmark. The catalog contains 275 tasks with the required difficulty counts (100/100/50/25); all 275 task results are not_run, scores are null, and the overall score is unavailable.

## Tests actually executed

- Benchmark package: 5 passed, 0 failed.
- Security/runtime/issue regression group: 70 passed, 0 failed.
- Workspace/usage/dashboard group: 10 passed, 0 failed.
- Stage 11 Phase 4 feature group: 17 passed, 0 failed.

These test counts are not benchmark task scores. The independent coding fixture intentionally starts with seeded failing assertions; it is not an Abyx failure.

## Environment and limitations

Windows 11 Home build 10.0.26300, Node v26.11.1, AMD Ryzen 9 8940HX, 32 logical CPUs, ~31.1 GiB physical RAM; GPU could not be verified. No live provider/model, browser UI, MCP server, or task execution was measured. Source inventory and security test evidence are summarized in CAPABILITY_INVENTORY.md and SECURITY_BENCHMARK_REPORT.md. No claim of OS isolation is made.

## Reproduction and recovery

Follow benchmarks/README.md to create a disposable workspace/data directory, run the local app on loopback with the explicit provider/model, verify the approved root, and execute selected tasks sequentially. Raw runs should be retained; never overwrite the user's app data. This report can be regenerated with node benchmarks/runners/generate-reports.cjs.
