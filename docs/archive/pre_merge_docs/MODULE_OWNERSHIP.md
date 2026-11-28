# ABYX Unified AI Studio — Subsystem Module Ownership Registry

**Version:** 2.1.0  
**Date:** 2026-11-25  
**Exit Condition:** Every major subsystem has exactly one clear, authoritative owner file and directory.

---

## 1. Subsystem Ownership Matrix

| Major Subsystem | Primary Upstream Reference | Authoritative Owner File | Directory Scope | Secondary / Supporting Modules |
| :--- | :--- | :--- | :--- | :--- |
| **Agent Lifecycle & Loop** | Pi | [`agent/execution_loop.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/execution_loop.js) | `agent/` | `agent/index.js`, `agent/execution_logger.js` |
| **Task DAG Orchestration** | LangGraph.js | [`agent/orchestrator.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/orchestrator.js) | `agent/` | `agent/scheduler.js`, `agent/task_store.js` |
| **Task Scheduling & Cycles** | LangGraph.js | [`agent/scheduler.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/scheduler.js) | `agent/` | `agent/orchestrator.js` |
| **Specialized Agent Catalog**| OpenCode + Pi | [`agent/agent_registry.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/agent_registry.js) | `agent/` | `services/subagents.js` |
| **Policy & Permissions** | OpenCode + OpenClaw | [`agent/policy_engine.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/policy_engine.js) | `agent/` | `agent/tool_gateway.js` |
| **Workspace Path Sandboxing**| OpenHands | [`agent/path_guard.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/path_guard.js) | `agent/` | `agent/tools/fs_tool.js` |
| **Git Snapshots & Rollback** | OpenCode | [`agent/git_adapter.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/git_adapter.js) | `agent/` | `agent/tools/fs_tool.js` |
| **Tool Execution Gateway** | OpenCode + Pi | [`agent/tool_gateway.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/tool_gateway.js) | `agent/` | `agent/tool_registry.js`, `agent/tools/*` |
| **Filesystem Tooling** | OpenCode | [`agent/tools/fs_tool.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/tools/fs_tool.js) | `agent/tools/` | `services/file_service.js` |
| **Terminal Execution** | OpenHands + OpenClaw | [`agent/tools/terminal_tool.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/tools/terminal_tool.js) | `agent/tools/` | `agent/policy_engine.js` |
| **LSP & Code Diagnostics** | Microsoft LSP | [`agent/tools/lsp_tool.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/tools/lsp_tool.js) | `agent/tools/` | `services/repository_context.js` |
| **Browser Scraping & Nav** | Playwright CLI | [`agent/tools/browser_tool.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/tools/browser_tool.js) | `agent/tools/` | `services/browser_service.js` |
| **Memory & Findings Store** | SQLite + Mem0 | [`agent/shared_memory.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/shared_memory.js) | `agent/` | `db.js`, `services/rag_service.js` |
| **Inter-Agent Message Bus** | Pi + LangGraph | [`agent/message_bus.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/message_bus.js) | `agent/` | `agent/orchestrator.js` |
| **Skills & Extensions** | OpenClaw + Pi | [`services/abyx_skills.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/services/abyx_skills.js) | `services/` | `extensions/extension_service.js` |
| **Model Inference Routing** | DeepSeek / llama.cpp | [`agent/model_router.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/model_router.js) | `agent/` | `security/credential_store.js` |
| **HTTP Server & API Routes** | Express/Node HTTP | [`scripts/server/harness_routes.cjs`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/scripts/server/harness_routes.cjs) | `scripts/server/`| `scripts/server/serve.cjs` |
| **Multi-Agent Workspace UI** | OpenCode Layout | [`app/frontend/src/components/MultiAgentWorkspace.jsx`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/app/frontend/src/components/MultiAgentWorkspace.jsx) | `app/frontend/` | `app/dist/` (Vite Build) |
| **Verification & QA Suite** | Harbor / Terminal-Bench | [`test/qa_failure_scenarios_test.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/test/qa_failure_scenarios_test.js) | `test/` | `test/real_multiagent_workflow_test.js` |

---

## 2. Invariants & Conflict Resolution Rules

1. **Single Entrypoint Invariant:**
   - All agent engine instantiations MUST route through `createAgentEngine` exported by [`agent/index.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/index.js).
   - Direct manual instantiation of decoupled subsystems is prohibited outside test harnesses.
2. **Path Resolution Invariant:**
   - No filesystem tool or service may access the disk without validating the path through [`agent/path_guard.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/path_guard.js).
3. **Execution Policy Invariant:**
   - Every tool call dispatched to [`agent/tool_gateway.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/tool_gateway.js) must be evaluated by [`agent/policy_engine.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/policy_engine.js). In Plan Mode, write and terminal calls are unconditionally rejected.
4. **Git Safety Invariant:**
   - Every destructive tool execution in [`agent/tools/fs_tool.js`](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/tools/fs_tool.js) must invoke `GitAdapter.createSnapshot()` before writing bytes to disk.
5. **No Framework Duplication Invariant:**
   - Under no circumstances shall an external monolithic agent framework be integrated alongside the native microkernel.
