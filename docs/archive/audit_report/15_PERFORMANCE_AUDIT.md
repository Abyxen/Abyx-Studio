# Performance Audit

No runtime profiling or benchmark was run, so there are no measured performance claims. Static risk areas:

- `harness/agent_seam.js` serializes and rewrites the full session JSON on every event/turn; latency and file growth will rise with long sessions.
- `services/context_manager.js` recalculates message estimates and performs string/JSON handling synchronously; accuracy is not tokenizer-backed.
- `services/ai_providers.js`/provider adapters stream through potentially different formats; normalization and retries can add latency or duplicate requests.
- Multiple local model/media processes compete for GPU memory and CPU; process lifecycle/health status must be measured under concurrent workloads.
- RAG indexing and embedding cost scales with document size; chunking, batch sizes and persistence need workload tests.
- Large frontend files (`services/api.js`, `App.jsx`, `TextChat.jsx`, `HarnessManager.jsx`) and generated bundles may increase maintainability and UI update cost, but no bundle/profile data was inspected.

Measure cold/warm startup, first-token latency, total completion latency, tokens/sec where provider reports it, tool dispatch overhead, cancellation time, CPU/RAM/GPU/VRAM, DB/session growth, index duration and UI interaction responsiveness. Use reproducible model/hardware/provider settings, warm-up, at least 10 repetitions for latency distributions, and report median/p95; separate network/model variance from harness overhead. Optimize only after establishing baseline and correctness. Keep generated artifact and dependency sizes separate from source bundle metrics.
