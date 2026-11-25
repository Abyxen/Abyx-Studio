# File Change Plan (Future Work Only)

No app files were changed during Stage 0. Files listed are likely owned by the respective future prompt. Every change must be compared to the current working diff first.

| Existing path | Preserve/refactor/retire | Rationale and planned ownership |
|---|---|---|
| `agent/policy_engine.js` | Refactor | Replace regex/prefix command classification; define policy contract. Existing session grants are not threaded into call context and must not be broadened accidentally. |
| `agent/path_guard.js` | Refactor | Keep sensitive-name denylist as defense-in-depth; fix missing ancestor, junction/symlink and no-follow operations. Review dirty ADS change. |
| `agent/tools/fs_tool.js` | Refactor | Preserve diff/backup intentions; verify backup success, cleanup temp writes, conflict semantics and atomic replacement on Windows. Existing user diff is substantial. |
| `agent/tools/terminal_tool.js` | Refactor | Keep streaming/cancel intent; replace `exec` boundary for restricted commands and fix POSIX process tree cleanup. |
| `harness/plugins/provider_sandbox.js` | Rename/replace boundary | It is Node VM + Python subprocess, not a hostile-code sandbox. Keep functionality only with explicit trusted-execution policy or OS isolation. |
| `services/process_lifecycle_manager.js` | Refactor | Current untracked implementation is active; inspect user changes carefully. Add PID identity, safe stale handling, atomic manifest and scoped shutdown. |
| `scripts/server/serve.cjs` | Incremental split | Preserve model/media management; centralize Origin/auth/shutdown and route middleware. Avoid broad rewrite of 9k-line server. |
| `scripts/server/harness_routes.cjs` | Refactor thin routes | Keep endpoint compatibility adapter; route all execution through one runtime, correct SSE disconnect and include session ownership. |
| `scripts/server/cloud_routes.cjs` | Preserve then harden | Workspace file API already uses PathGuard; enforce origin/auth and safe user action policy; maintain output compatibility. |
| `agent/execution_loop.js` | Canonical runtime | Keep run/approval/timeline types where sound; add explicit state transitions and a single ToolGateway. |
| `harness/agent_seam.js` | Consolidate then retire | Disconnected alternate agent and JSON history; do not remove until session export/migration and behavior parity exist. |
| `harness/plugins/consumer_tools.js` | Convert adapter | Retain provider-specific schema conversion; remove duplicate tool ownership and direct dispatch once registry is ready. |
| `services/mcp_client.js` | Implement or disable remote claim | Local utilities currently dispatch; remote config only contributes schemas. Add real transport under ToolGateway or clearly disable external server tools. |
| `extensions/plugin_runner.js`, `extension_service.js`, `package_manager.js` | Trust-boundary redesign | Existing package/manifest UX may remain; module `require` is server-process code, not isolation. Keep hidden/disconnected until safe lifecycle. |
| `providers/registry.js`, `services/ai_providers.js`, adapters | Normalize incrementally | Preserve existing models/providers; formalize descriptor/stream/errors; avoid replacing healthy adapter implementations without contract failures. |
| `services/context_manager.js` | Replace estimate semantics | Existing API/UI can remain; label estimate confidence and use provider tokenizer metadata; only compact typed history. |
| `agent/execution_logger.js`, `db.js`, `db_migrations.js` | Additive event storage | Preserve historical run export and migration compatibility; no deletion of old session files during rollout. |
| `rag/*`, `services/rag_service.js` | Preserve and evaluate | Existing SQLite/FTS/vector storage and parsing are valuable; add evaluation/provenance before indexing architecture changes. |
| `services/subagents.js`, `automations/*` | Rework after job service | Retain personas/workflows; give them durable Job IDs, scope, cancel and sandbox only after foundations. |
| `services/model_manager_service.js`, workers, `serve.cjs` | Integrate supervisor | Keep modality-specific workers; share only lifecycle/health contracts. No unnecessary model-library migration. |
| `app/frontend/src/components/HarnessManager.jsx`, `TextChat.jsx`, `DiffViewer.jsx`, `TerminalConsole.jsx`, `services/api.js` | Improve after API stable | Preserve Abyx layout/theme. Add run, approval, context-confidence and recovery states against canonical events. |
| `test/agent_harness_test.js`, `test/temp_workspace/*` | Preserve | Existing untracked fixture includes files/backups. Do not run current test because it recursively removes this directory. Future tests must use unique OS temp directories and cleanup only their own paths. |

## Potential new modules (not created)

`tools/registry.js`, `tools/gateway.js`, `security/process_sandbox.js`, `sessions/event_store.js`, `providers/contracts.js`, route schemas, isolated fixtures and benchmark runner. Create only after the interfaces in 03 are approved.
