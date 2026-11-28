# ABYX Unified AI Studio — Merge Source Inventory

**Target Canonical Root:** `C:\Users\abira\Documents\Local Ai studio Abyx`  
**Secondary Source:** `C:\Users\abira\Documents\Open Abyx`  
**Date:** 2026-11-26  

---

## 1. Inventory of Codebase A: `Local Ai studio Abyx` (Canonical Root)

| Path | Purpose & Responsibilities | Classification | Retain / Upgrade / Replace |
|---|---|---|---|
| `electron/main.js`, `electron/preload.js` | Desktop application lifecycle, window management, IPC channels | Core Desktop Shell | **RETAIN (Primary shell)** |
| `app/dist/` | Production React 19 frontend bundle (dashboard, chat, tools, settings) | Primary Frontend | **RETAIN (Primary UI)** |
| `app/backend/win/cuda/` | Bundled `llama-server.exe` CUDA runtime for local RTX 5060 GPU | Local LLM Server | **RETAIN (Hardware backend)** |
| `app/llm-models/AbyxV2 9B.gguf` | Local 9B quantized GGUF model for 0-cost, 0-latency inference | Local Model | **RETAIN (Local model)** |
| `db.js`, `db_migrations.js` | SQLite persistence for conversations, settings, audit logs, runs | Database Layer | **RETAIN (Primary persistence)** |
| `agent/execution_loop.js` | 692-line model-driven execution loop with `modelRouter.chat` | Agent Runtime | **UPGRADE (Add unified tool registry & OpenHands verification)** |
| `agent/model_router.js` | 628-line hardware-aware inference router for port 10086 + cloud | Model Routing | **RETAIN & UPGRADE (Canonical model bridge)** |
| `agent/tool_gateway.js`, `tool_registry.js` | Tool schema validation, execution routing, audit logging | Tool Subsystem | **UPGRADE (Merge with OpenHands tools)** |
| `agent/policy_engine.js` | 20KB policy validator, risk levels, human approvals, path guards | Security Subsystem | **RETAIN (Canonical security gate)** |
| `providers/` | Anthropic, Gemini, OpenAI, Ollama, LMStudio, Custom adapters | Model Adapters | **RETAIN (Canonical provider suite)** |
| `services/mcp_client.js`, `mcp_stdio_manager.js` | Real stdio MCP client and server manager | MCP Integration | **RETAIN (Live MCP support)** |
| `services/abyx_skills.js`, `skills/` | Skill catalog and instruction prompt injection | Skills Integration | **RETAIN (Skill ecosystem)** |
| `services/automation_service.js`, `automations/` | Scheduled background task triggers and definitions | Automation Engine | **RETAIN & UPGRADE** |

---

## 2. Inventory of Codebase B: `Open Abyx` (Harness & Tool Innovations)

| Path | Purpose & Responsibilities | Classification | Action for Merger |
|---|---|---|---|
| `src/tools/python_doc_tools.py` | Standalone Python suite (ReportLab PDF, python-docx, openpyxl, pptx, ZIP SHA-256) | Document Tools | **IMPORT to `services/python_doc_tools.py`** |
| `src/harness/tools/python_doc_runner.js` | Node.js child-process runner for Python document generator | Tool Runner | **IMPORT to `agent/tools/python_doc_tool.js`** |
| `src/harness/tools/playwright_browser.js` | Dedicated Playwright Chromium automation tool (DOM, clicks, typing, screenshots) | Browser Tool | **IMPORT to `agent/tools/playwright_browser_tool.js`** |
| `src/harness/tools/process_manager.js` | Long-running detached process manager with synchronous log streaming & recovery | Process Tool | **IMPORT to `services/process_manager.js`** |
| `src/harness/tools/internet_research.js` | Multi-source internet research, page extraction, citation synthesizer | Research Tool | **IMPORT to `agent/tools/research_tool.js`** |
| `src/harness/verification_eval.js` | Deterministic verification hooks, Automated Judge, Structured Error Feedback | Evaluation Subsystem | **IMPORT to `agent/verification/`** |
| `src/harness/trajectory_state.js` | JSONL trajectory tracer, checkpoint rollback manager, session handoff | State & Rollback | **IMPORT to `agent/`** |
| `src/harness/goal_orchestrator.js` | Goal loop (/goal, /plan, /code, /verify) with iterative criteria evaluation | Goal Engine | **IMPORT to `agent/goal_orchestrator.js`** |
| `src/harness/subagent_orchestrator.js` | Multi-subagent runner with isolated workspaces (`.subagents/sub_*`) | Subagent Engine | **IMPORT to `agent/subagent_orchestrator.js`** |
| `src/api/server.js`, `websocket_server.js` | Unified HTTP REST (port 3000) & WebSocket server (port 3001) with SSE | Gateway Subsystem | **IMPORT to `services/api_gateway.js`** |
| `test/acceptance.test.js` | 13 mandatory acceptance criteria test suite | Test Infrastructure | **IMPORT to `test/acceptance_merged.test.js`** |
| `test/benchmarks.test.js` | 3 canonical OpenHands benchmark inputs | Benchmark Suite | **IMPORT to `test/benchmarks_merged.test.js`** |
| `public/` | Monochrome web UI for headless/browser access | Alternative Web UI | **IMPORT to `app/public_web/`** |
| `tests/test_all_23_subsystems.py` | Abandoned Python test prototype | Outdated Prototype | **DISCARD (Exclude from canonical)** |
