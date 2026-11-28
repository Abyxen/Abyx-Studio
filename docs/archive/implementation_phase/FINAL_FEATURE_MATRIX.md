# Final Feature Matrix

Status describes current source support, not product parity. “Implemented” means code and focused tests exist; “Partial” means a material lifecycle, isolation, recovery, or runtime verification gap remains.

| Area | Status | Evidence and limit |
|---|---|---|
| Chat and streaming | Partial | Local chat UI and stream handling exist; live UI interaction was not verified in this environment. |
| Harness run review | Partial | Harness UI consumes named SSE events, records a bounded timeline, shows run lifecycle states and errors, exposes approval arguments, and allows keyboard selection of run history. A live click-through was blocked by loopback access restrictions. |
| Coding agent | Partial | Workspace read/write/edit, bounded repository inspection, diff preview and read-only Git status/diff/log/branch exist. No transactional multi-file patch set, Git stage/commit, or isolated test execution. |
| General agent | Partial | Web search/fetch, files, research, documents and study tools are present. These are spread across routes and loops; durable jobs and uniform recovery are absent. |
| AI Studio media | Partial | Image/video, transcription, TTS and local model workers are present and optional. Hardware-backed start/stop/restart and failure recovery were not exercised. |
| Tool authorization | Partial | Registry/Gateway enforce the active Harness tool path and direct terminal endpoints have policy checks. Stage 3 consolidation is absent, so all product paths are not one runtime. |
| Skills | Implemented with limits | Instruction-only skill discovery and lifecycle; skills do not grant host permissions. |
| MCP | Partial | Stdio management, namespaced tools, schemas, timeouts and gateway integration exist. Runs as the current user; no OS isolation or automatic reconnect. |
| Extensions | Fail-closed | Executable extensions are not loaded in-process or activated. Isolated extension host is unavailable. |
| Local/cloud providers | Partial | Provider adapters and discovery exist. The single normalized Stage 4 provider gateway is incomplete; provider integration suite was blocked by local socket restrictions. |
| Sessions and recovery | Partial | SQLite chat/profile/usage plus JSON run/session data exist. No canonical event store or crash-safe exact-once replay contract. |
| Context and RAG | Partial | Provider-aware estimates/usage, safe compaction grouping, SQLite FTS/hash-vector retrieval, citations and stale-source filtering exist. Corpus-scale quality and live UI citations were not measured. |
| Memory | Partial | Profile memory management exists. Automatic reviewer writes were changed to proposals; project-scoped memory and durable proposal history are absent. |
| Observability | Partial | Run/tool identifiers, scrubbed run logs and usage analytics exist. No unified provider-correlated log schema, retention/diagnostic export contract, or full evaluation dashboard was verified. |
| Process lifecycle | Partial | Manifest-only PIDs are no longer kill authority; direct registered child handles are used. Job Objects, descendant ownership, resource quotas and recovery remain missing. |
| Accessibility and responsive UI | Unverified | Source was inspected and the frontend builds. Keyboard, screen-reader, contrast, responsive and click-through checks could not be completed because UI automation could not determine the live browser URL. |
| Startup and upgrade | Partial | Frontend build succeeds. Backend could not bind to port 1420 during this validation; migration and model start were not validated against the live user database. |
| Performance | Not measured | No valid startup/API/model/session/concurrency benchmark samples were collected. |

## Competitor-inspired assessment

The documented comparison in `AUDIT_REPORT/01_COMPETITOR_RESEARCH.md` and `04_FEATURE_BY_FEATURE_COMPARISON.md` is source/documentation research, not a run-for-run benchmark. Abyx has broader local media-studio surfaces than coding-focused OpenCode or Pi, and shares plugin-composition ideas with DeepSeek Harness. Its gaps remain canonical runtime/session contracts, inspectable coding changes, authenticated ownership, genuine process isolation, and verified end-to-end UX. No complete parity claim is supported.
