# File-Level Change Plan (Recommendations Only)

No files were changed by this audit. Likely future changes:

| Existing path | Recommended responsibility |
|---|---|
| `agent/policy_engine.js` | Replace regex-based shell allow classification with typed executable/action permissions and approval-bound arguments. |
| `agent/path_guard.js` | Canonical path component traversal and safe filesystem handle policy; retain sensitive path deny rules with tests. |
| `agent/tools/terminal_tool.js` | Delegate to OS-isolated process service; robust cancellation, process tree ownership and bounded streaming. |
| `harness/plugins/provider_sandbox.js` | Rename/document as code runner unless OS isolation is implemented; remove unsafe VM security implication. |
| `agent/execution_loop.js` | Canonical runtime, state machine, ToolGateway-only dispatch, resume/cancel handling. |
| `harness/agent_seam.js` | Either become adapter into canonical runtime or retire; remove policy-bypassing direct dispatcher and duplicate session store. |
| `harness/plugins/consumer_tools.js` | Schema declaration/compatibility adapter only; central registry supplies tools and execution. |
| `scripts/server/harness_routes.cjs` | Route validation, authenticated session ownership, disconnect-aware SSE, no direct unvalidated model output handling. |
| `scripts/server/serve.cjs` | Origin/auth enforcement, graceful shutdown and route delegation; split domains into route modules. |
| `services/context_manager.js` | Provider-aware token budgeting and safe typed compaction integrated into runtime. |
| `agent/execution_logger.js`, `db.js`, `db_migrations.js` | Common versioned event/session persistence with retention and recovery. |
| `providers/registry.js`, `services/ai_providers.js`, `providers/*_adapter.js` | Normalize model descriptor, capabilities, stream events, failure/retry contract. |
| `services/mcp_client.js`, `extensions/*`, `services/abyx_skills.js` | Permissioned capability lifecycle, trust/provenance and uniform audit. |
| `services/workspace_service.js`, `agent/tools/fs_tool.js` | Workspace identity and concurrent edit/diff staging, preserving user files. |
| `app/frontend/src/components/HarnessManager.jsx`, `TextChat.jsx`, `DiffViewer.jsx`, `TerminalConsole.jsx` | Show canonical run state, decision rationale, exact diff, cancel/retry and accessible approval. |
| `app/frontend/src/services/api.js` | Typed endpoint/event contracts and shared error/cancellation handling; reduce one-file API sprawl. |

Potential additions after architecture gate: `tools/registry.js`, `tools/gateway.js`, `security/process_sandbox.js`, `sessions/event_store.js`, `providers/contracts.js`, `api/schemas/`, benchmark fixtures and security integration tests. Do not remove legacy paths until parity and migration are tested. Current uncommitted modifications should be reviewed independently before future refactoring.
