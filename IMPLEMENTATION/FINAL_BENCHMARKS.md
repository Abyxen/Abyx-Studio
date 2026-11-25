# Final Benchmarks

No product performance benchmark was completed. No median or p95 values are reported because sample sizes and runtime conditions were insufficient.

## Environment observed

- OS: Windows (the active repository/test environment).
- Node: v26.11.1, reported by the provider test failure stack.
- Hardware: not captured.
- Active provider/model: not captured or controlled.
- Frontend build: Vite 8.3.5, React production build, one successful sample. Vite reported 1.85 seconds in its own build summary; this is a single build-time observation, not a startup or UI responsiveness benchmark.
- Output: build emitted to a unique temporary directory, not `app/dist`.

## Not measured

Application startup, first-token/full-response latency, API latency, context compaction overhead, tool overhead, session load/recovery, provider switching, RAG indexing/recall, concurrent jobs, process resource limits, memory/CPU/GPU usage, and responsive UI input latency.

The backend could not start a validation instance on port 1420 because that address was already in use; loopback requests from the shell were also denied by the environment. Cloud/provider benchmark calls and real media jobs were not run. No comparison benchmark against OpenCode, Pi or DeepSeek Harness was performed.

## Reproduction plan

Pin a commit, OS/build, CPU/RAM/GPU, model file hash, provider endpoint, context size, permission profile and concurrency. Warm up once, then capture at least 20 valid runs per scenario. Report median and p95 for startup, API, first-token, completion, tool, retrieval and cancellation latency, plus error counts and hardware utilization. Keep model quality evaluation separate from harness overhead. The scenarios in `AUDIT_REPORT/18_BENCHMARK_TEST_PLAN.md` are the proposed baseline.
