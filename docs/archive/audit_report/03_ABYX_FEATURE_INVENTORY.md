# Abyx Feature Inventory

Statuses use the requested vocabulary. “Verified” here means source path and tests/code evidence were directly inspected; it does not imply runtime execution. No tests were run.

| Capability | Status | Evidence and qualification |
|---|---|---|
| React desktop/web UI shell | IMPLEMENTED BUT PARTIAL | `App.jsx`, `main.jsx`, Vite config and feature components exist; no UI smoke/accessibility run. |
| Local Node HTTP server | IMPLEMENTED AND VERIFIED (static) | `scripts/server/serve.cjs` creates routes and binds loopback by default; broad wildcard CORS and optional public bind require security work. |
| Cloud and local provider adapters | IMPLEMENTED BUT PARTIAL | `providers/registry.js`, adapter modules, `services/ai_providers.js`; diverse integrations, but unified capability/error/context behavior not established. |
| Model catalog/selection | IMPLEMENTED BUT PARTIAL | Model manager/config/API functions exist; model-specific context/token support is heuristic. |
| Main bounded agent loop | IMPLEMENTED BUT PARTIAL | `agent/execution_loop.js` has max-step, policy, approval, cancel and timeline constructs. Route's shortcut condition is unreachable after step increment; live behavior untested. |
| Alternate HarnessAgentLoop | PRESENT BUT UNTESTED | `harness/agent_seam.js`; separate Ollama/cloud loop and JSON store; not wired into main agent route. |
| Built-in filesystem tools | IMPLEMENTED BUT PARTIAL | `agent/tools/fs_tool.js`; diff/backup/atomic-write intentions exist; path guard has ancestor/race gaps; no OS isolation. |
| Terminal tool | IMPLEMENTED BUT BROKEN (security contract) | `terminal_tool.js` invokes general shell; safe-command regex in policy can accept shell suffixes; cwd containment is not process sandbox. |
| Browser and web search | IMPLEMENTED BUT PARTIAL | browser tool/service and SSRF helper exist; `fetchPage` builds timeout signal but does not pass it to `fetchPublicResponse`; runtime behavior untested. |
| Skills catalog/consult | IMPLEMENTED BUT PARTIAL | `services/abyx_skills.js`, research skills and API; capabilities are code-defined and loaded as consultation, not demonstrated as contextual skill discovery/composition. |
| MCP configuration/client | IMPLEMENTED BUT PARTIAL | `services/mcp_client.js`, routes and consumer dispatch exist; lifecycle, auth, reconnect and policy integration need proof. |
| Extension install/runner | IMPLEMENTED BUT PARTIAL | `extensions/*`; manifest validation/package management exist, but runner uses `require()` in process and should be treated trusted. |
| Subagents | IMPLEMENTED BUT PARTIAL | `services/subagents.js`, UI and plugin tool; no evidence of isolated worktrees/context, scheduling, or robust fan-out. |
| Context telemetry/compaction | IMPLEMENTED BUT PARTIAL | `services/context_manager.js` endpoints; hand-estimated tokens and extractive topic note; not automatic in agent loop. |
| RAG and document ingestion | IMPLEMENTED BUT PARTIAL | `rag/*`, `services/rag_service.js`, DB; parsers/chunking/embeddings present, retrieval quality and lifecycle untested. |
| SQLite chat/usage persistence | IMPLEMENTED AND VERIFIED (static) | `db.js`, migrations contain chat/usage/profile tables; agent session paths are separate JSON. |
| Automation | IMPLEMENTED BUT PARTIAL | `automations/*`, service and routes; execution environment and approval model need validation. |
| Image/speech/TTS/video studios | IMPLEMENTED BUT PARTIAL | React components, worker/setup scripts, APIs; external native/model runtimes required and not started. |
| AI Studio observability | IMPLEMENTED BUT PARTIAL | usage/telemetry/model status endpoints and screens exist; no end-to-end metric accuracy proof. |
| Git-aware coding | NOT IMPLEMENTED (agent-native) | No dedicated Git tool/provider found in agent registry; `PathGuard` blocks `.git` paths. Terminal can run Git subject to shell policy but this is not a structured Git workflow. |
| Sandboxed execution | IMPLEMENTED BUT BROKEN (claim exceeds boundary) | `provider_sandbox.js` uses Node `vm` or Python subprocess; VM is not a security sandbox and Python runs with OS user privileges. |
| Production-grade permission audit trail | IMPLEMENTED BUT PARTIAL | policy approvals and `ExecutionLogger`; multiple paths may bypass it, approvals are process-local, and no authenticated audit identity. |
| DeepSeek Harness compatibility | NOT IMPLEMENTED | `harness/` is Abyx-authored Cordis-inspired code, not the DSH runtime/API. |

NOT APPLICABLE is reserved for features irrelevant to this desktop workstation; none of the requested major harness capabilities was classified N/A.
