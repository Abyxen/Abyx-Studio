# ABYX Unified AI Studio — Architecture Specification & Implementation Blueprint

**Version:** 2.0.0 (Post-Cleanup Rebuild)  
**Date:** 2026-11-25  
**Author:** Antigravity Autonomous Engineering Agent  
**Target:** Local-First, High-Performance Multi-Agent Harness for Windows

---

## 1. Architectural Principles & Inspirations

ABYX unifies the strongest practical architectures from modern agentic systems into a coherent, production-grade local AI workstation:

```
+-----------------------------------------------------------------------------------+
|                           ABYX UNIFIED AI STUDIO                                  |
+-----------------------------------------------------------------------------------+
|  PRESENTATION LAYER (OpenCode Layout)                                             |
|  - 3-Pane Monochromatic Dark Workspace (Sessions | Canvas & Stream | Telemetry)   |
|  - Real-Time SSE Event Consumers & Live Markdown / Diff Viewers                   |
|  - Hardware Inference Controls (CUDA/CPU, Temp, Tokens, KV Cache, Threads)        |
+-----------------------------------------------------------------------------------+
|  DURABLE ORCHESTRATION & STATE LAYER (LangGraph.js Pattern)                       |
|  - StateGraph Checkpointer (SQLite / JSONL persistence)                           |
|  - Dynamic DAG Task Scheduler (Topological Sort, Cycle Detection, Concurrency)    |
|  - Human-in-the-Loop Interruption & Resumption Engine                             |
+-----------------------------------------------------------------------------------+
|  AGENT EXECUTION & LIFECYCLE LAYER (Pi Pattern)                                   |
|  - Session State Machine (idle -> running -> waiting_approval -> compacting)       |
|  - Autonomous Execution Loop with AbortSignal cancellation                        |
|  - Dynamic Context Compactor & Memory Pruner (75% context boundary trigger)       |
+-----------------------------------------------------------------------------------+
|  POLICY, PERMISSIONS & TOOL GATEWAY (OpenCode & OpenHands Pattern)                |
|  - Plan Mode vs Build Mode enforcement                                            |
|  - Granular Policy Matrix (allow / ask / deny per tool and path)                  |
|  - Git Snapshot Adapter (pre-execution snapshot & atomic rollback)                |
|  - Scoped Tool Suite: FS (safe path), Terminal (isolated), LSP, Playwright CLI   |
+-----------------------------------------------------------------------------------+
|  PERSISTENCE, SKILLS & MEMORY (Mem0 & OpenClaw Pattern)                           |
|  - SQLite FTS5 Persistent Memory Store & Vector RAG                               |
|  - Inter-Agent Message Bus (Direct & Broadcast channels)                          |
|  - OpenClaw SKILL.md Loader & Dynamic Prompt Injection                            |
+-----------------------------------------------------------------------------------+
|  INFERENCE & HARDWARE BRIDGES (DeepSeek / llama.cpp / Cloud)                     |
|  - Local AbyxV2 9B.gguf on 127.0.0.1:10086 (Dynamic Budgets, Reasoning Extract)   |
|  - Unified Cloud Model Provider (OpenAI, Anthropic, Gemini, Groq, Ollama)         |
+-----------------------------------------------------------------------------------+
```

---

## 2. Core Subsystems to Rebuild

### Subsystem 1: Core Agent Runtime & Execution Loop (`agent/execution_loop.js`, `agent/index.js`)
- **Pi Session Lifecycle:** State transitions (`idle`, `running`, `waiting_approval`, `compacting`, `completed`, `failed`, `cancelled`).
- **Autonomous Turn Loop:** Maximum turns bounded (15), streaming deltas to UI over SSE (`turn:start`, `reasoning:delta`, `tool:call`, `tool:result`, `turn:end`).
- **Context Compaction:** Calculates token consumption per turn; when approaching 75% of context window, compacts older tool outputs into concise findings, keeping system instructions and recent conversation intact.

### Subsystem 2: Policy Engine & Tool Gateway (`agent/policy_engine.js`, `agent/path_guard.js`, `agent/tool_gateway.js`, `agent/tools/*`)
- **Path Guard:** Resolves real filesystem paths, enforces workspace boundaries, prevents directory traversal (`..`).
- **Policy Engine:** Mode-aware (`plan` vs `build`), checks `allow`, `ask`, `deny` per tool and argument pattern.
- **Git Adapter Integration:** Automatically creates a git stash/checkpoint before destructive writes so user can rollback any tool change.
- **Tools Suite:**
  - `fs_tool`: `read_file`, `write_file`, `edit_file`, `list_directory`, `search_files`.
  - `terminal_tool`: `run_command` with blocked commands, timeout, cwd bounds, and output truncation.
  - `lsp_tool`: `diagnostics`, `symbols`, `validate_syntax`.
  - `browser_tool`: Playwright automation, DOM extraction, screenshot staging.

### Subsystem 3: Durable Multi-Agent Orchestrator & Scheduler (`agent/orchestrator.js`, `agent/scheduler.js`, `agent/task_store.js`)
- **StateGraph:** Checkpointed execution state in `app/data/orchestrations.json` and SQLite.
- **DAG Scheduler:** Topological task ordering, parallel worker allocation up to concurrency limit (default 4), cycle detection.
- **Specialized Agent Registry:** 12 pre-configured agents:
  1. `architect`: System design, modular planning, DAG decomposition.
  2. `coder`: Full-stack implementation, refactoring, algorithms.
  3. `reviewer`: Code quality, consistency, edge case detection.
  4. `security`: OWASP Top 10 auditing, path bounds, auth checks.
  5. `test_commander`: Test suite generation, failure reproduction, assertions.
  6. `rag_specialist`: Document parsing, semantic search, vector indexing.
  7. `browser_navigator`: Web crawling, DOM scraping, form interaction.
  8. `data_engineer`: Data cleaning, schema transformation, pipeline queries.
  9. `ui_designer`: Dark-theme layouts, responsive components, CSS tokens.
  10. `debugger`: Log tracing, error triage, stack trace analysis.
  11. `performance_profiler`: Latency bottlenecks, memory leak checks.
  12. `researcher`: Technical documentation, paper review, citation synthesis.

### Subsystem 4: Shared Memory, Message Bus & Event Store (`agent/shared_memory.js`, `agent/message_bus.js`, `agent/event_store.js`)
- **Shared Memory:** SQLite FTS5-backed knowledge store for facts, findings, and task artifacts.
- **Message Bus:** Structured inter-agent communication (`direct`, `broadcast`) with correlation IDs.
- **Event Store:** Append-only JSONL event stream for auditing and replay.

### Subsystem 5: OpenCode Multi-Agent Workspace UI (`app/frontend/src/components/MultiAgentWorkspace.jsx`)
- 3-pane layout:
  - Left: Session tree, active agents, mode toggle (Plan / Build), skill selector.
  - Center: Live execution canvas, reasoning drawer (DeepSeek thought process), tool call logs, diff viewer.
  - Right: Hardware inference controls (temperature, context size, GPU layers, CPU threads, batch size, KV cache), live telemetry metrics.

---

## 3. Implementation Sequence (Phases 3 to 6)

1. **Phase 3:**
   - Implement `agent/path_guard.js` & `agent/policy_engine.js`.
   - Implement `agent/git_adapter.js` integration.
   - Implement `agent/tools/fs_tool.js`, `agent/tools/terminal_tool.js`, `agent/tools/lsp_tool.js`, `agent/tools/browser_tool.js`.
   - Implement `agent/tool_gateway.js` and `agent/tool_registry.js`.
   - Implement `agent/execution_loop.js` (Pi-style state machine and compaction).

2. **Phase 4:**
   - Implement `agent/task_store.js`, `agent/event_store.js`, `agent/shared_memory.js`, `agent/message_bus.js`.
   - Implement `agent/agent_registry.js` (12 specialized agents).
   - Implement `agent/scheduler.js` (DAG topological sorting and cycle detection).
   - Implement `agent/orchestrator.js` (LangGraph-style durable StateGraph).
   - Update `agent/index.js` exporting unified `createAgentEngine`.

3. **Phase 5:**
   - Connect `scripts/server/harness_routes.cjs` to the rebuilt engine.
   - Enhance `app/frontend/src/components/MultiAgentWorkspace.jsx` with full interactive controls, DAG visualizer, and SSE streaming.
   - Recompile frontend with Vite and verify on `http://localhost:1420`.

4. **Phase 6:**
   - Author and run comprehensive test suites:
     - `test/agent_harness_test.js` (Core runtime & tools).
     - `test/multi_agent_system_test.js` (DAG, scheduler, message bus).
     - `test/qa_failure_scenarios_test.js` (Harbor-style failure injection).
     - `test/real_multiagent_workflow_test.js` (Live model inference on 10086).
   - Generate final benchmark reports and status updates.
