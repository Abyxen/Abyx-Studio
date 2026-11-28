# Implementation Roadmap

Order reflects dependencies; file lists are likely touchpoints, not a committed change list. No implementation is performed by this audit.

| Stage | Objective / likely modules | Complexity, dependency | Acceptance gate |
|---|---|---|---|
| 0. Boundary repair | `agent/policy_engine.js`, `path_guard.js`, `terminal_tool.js`, `provider_sandbox.js`, server CORS/origin | HIGH/VERY HIGH; first | Unsafe shell compositions denied; symlink escape/race tests pass; sandbox claims match deployed OS boundary. |
| 1. Contract inventory | `agent/types.js`, `harness/*`, `providers/*`, route schemas | MEDIUM; stage 0 design | Document typed tool/model/run/event interfaces; reject duplicate or invalid tool schemas. |
| 2. One runtime | `agent/execution_loop.js`, `harness/agent_seam.js`, `harness_routes.cjs` | HIGH; 1 | All agent modes use one state machine and authorization gateway; cancellation and resume semantics explicit. |
| 3. Session/event persistence | `db.js`, migrations, `execution_logger.js`, session store | HIGH; 2 | Crash-safe event append/snapshot; restore active session without duplicate execution; profile/workspace ownership correct. |
| 4. Provider gateway | registry, adapters, `ai_providers.js`, model UI | HIGH; 1 | Adapter contract tests cover discovery, stream, tool calls, context, timeout, failover and redaction. |
| 5. Tool registry/MCP/extensions | `consumer_tools.js`, `mcp_client.js`, `extensions/*`, skills | HIGH; 0–2 | All capabilities have schema, identity, risk, timeout, approval and cancellation; untrusted extension policy is clear. |
| 6. Coding workflow | fs tool, workspace, diff, new Git adapter, terminal UI | HIGH; 0–5 | Multi-file diff review, safe Git status/diff, test run in isolation, recovery without data loss. |
| 7. Context/memory/RAG | `context_manager.js`, `rag/*`, DB | HIGH; 3–4 | Token telemetry labeled by confidence; compaction preserves tool state; fixed retrieval/citation suite passes. |
| 8. Jobs and general agent | automations, subagents, browser/document services | HIGH; 2–5 | Every job is durable/cancellable, resource-limited, audited and isolated by owner/workspace. |
| 9. UI integration | `HarnessManager.jsx`, `TextChat.jsx`, diff/approval components | MEDIUM; 2–5 | Keyboard flows, loading/error/empty states, run trace and approvals usability-tested. Preserve brand. |
| 10. Studio process lifecycle | model/media services and process manager | MEDIUM; parallel after contracts | Start/stop/health/cleanup and resource metrics work under concurrent jobs. |
| 11. Benchmark/stabilize | tests, benchmark fixtures, docs | HIGH; all | Reproducible CI scenarios and security regression gate; performance baselines published without invented results. |

Independent work after interface agreement: UI component polish, provider adapter contract suite and RAG evaluation fixture. Foundational dependency: security gate precedes autonomous shell; canonical runtime precedes subagents/automation; persistence precedes recovery; registry precedes broad MCP/extensions. Stage exit requires acceptance criteria, not merely visible UI.
