# Capability Inventory

Inventory recorded 2026-11-25 from source inspection and existing stage reports. This is a source/configuration inventory, not a successful end-to-end capability claim.

| Area | Evidence inspected | Status / boundary |
|---|---|---|
| Agent execution | agent/index.js, agent/execution_loop.js, scripts/server/harness_routes.cjs, harness/agent_seam.js | Several historical execution surfaces remain; legacy seam is disabled, while current SSE route is available in source. No live model task was executed. |
| Built-in tools | agent/index.js | Static agent tool definitions include filesystem, terminal, browser/search, repository/Git, LSP, file generation, memory and system information. Research tool definitions are additional; runtime success was not benchmarked. |
| Tool authorization | agent/tool_registry.js, agent/tool_gateway.js, agent/policy_engine.js | Registry/gateway and policy tests pass in the current regression suite. Runtime-wide bypass absence was not proven by this benchmark. |
| Filesystem | agent/path_guard.js, agent/tools/fs_tool.js | Workspace path guard and adversarial tests pass; no claim of OS-level file isolation. |
| Terminal/process | agent/tools/terminal_tool.js, services/process_lifecycle_manager.js | Approval and cancellation tests pass. Process executes as application user; Windows Job Object/restricted-token boundary is not established. |
| Browser | agent/tools/browser_tool.js and API routes | Source exists; live browser benchmark not run. |
| Providers | providers/registry.js, services/ai_providers.js | Multiple adapters/catalog paths exist. No provider was positively selected and exercised for this run. |
| Skills | services/abyx_skills.js | Instruction/skill discovery exists; no skill lifecycle task run. |
| MCP | services/mcp_client.js, services/mcp_stdio_manager.js | MCP management/call paths exist; stdio process is not a separate security principal. No live external server task run. |
| Extensions | extensions/* | Current implementation/report describes fail-closed execution; no plugin installation or runtime task run. |
| Persistence / memory / RAG | db.js, services/context_manager.js, services/memory_reviewer.js, rag/knowledge_service.js | Source and related regression checks exist; recovery/RAG quality was not benchmarked. |
| Documents / media | services/universal_file_generator.js and media services | PDF and text/archive generation paths are present; office-format breadth and media workflows were not measured here. |
| Local API | scripts/server/serve.cjs, security/local_server_guard.js | Host/Origin and redaction tests pass. Live cross-origin requests were not run. |
| Jobs / subagents | stage implementation and route sources | Historical feature routes exist; durable isolated parallel workers not established by this benchmark. |

The runnable tool catalog is not equivalent to a capability success rate. See task results and limitations in the final report.
