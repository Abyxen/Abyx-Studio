# ABYX Unified AI Studio — Merge Conflict & Resolution Report

**Canonical Root:** `C:\Users\abira\Documents\Local Ai studio Abyx`  
**Date:** 2026-11-26  

---

## 1. Identified Architectural Conflicts

### Conflict 1: Dual Execution Loops
- **Conflict:** `Local Ai studio Abyx` had `agent/execution_loop.js` (an active loop calling `modelRouter.chat()`), while `Open Abyx` had `src/harness/orchestrator.js` (a step-based runner with linear stage gates and verification).
- **Resolution:** Combine both! Use `Local Ai studio Abyx`'s `AgentExecutionEngine` as the central loop, and enhance it with `Open Abyx`'s stage gates (DESIGN, IMPLEMENTATION, VERIFICATION, HANDOFF), trajectory tracing, checkpointing, and Automated Judge.

### Conflict 2: Dual Tool Registries & Gateways
- **Conflict:** `Local Ai studio Abyx` had `agent/tool_gateway.js` and `agent/tool_registry.js` with policy checks and approvals. `Open Abyx` had `src/harness/tools/` with Python doc runner, Playwright browser, and detached process manager.
- **Resolution:** Register all OpenHands-inspired tools from `Open Abyx` directly into `Local Ai studio Abyx`'s `ToolGateway` and `ToolRegistry`! This gives the model direct tool-calling access to `python_doc`, `playwright_browser`, `process_manager`, `internet_research`, and `smart_file_editor`.

### Conflict 3: Dual Communication Layers (Electron IPC vs HTTP/WebSocket)
- **Conflict:** `Local Ai studio Abyx` communicated exclusively via Electron IPC (`ipcMain` / `ipcRenderer`), while `Open Abyx` ran an HTTP REST and WebSocket server.
- **Resolution:** Integrate the HTTP REST (`/api/`) and WebSocket (`ws://`) server from `Open Abyx` as a background service inside `Local Ai studio Abyx`! When started, the application supports BOTH the Electron desktop UI (via IPC/local service) AND external CLI / web clients (via HTTP port 3000 / WebSocket port 3001).

### Conflict 4: Inconsistent Tool Interfaces
- **Conflict:** `Open Abyx` had tools returning `{ status, output }`, while `Local Ai studio Abyx` tool gateway expected `{ success, output, error }`.
- **Resolution:** Provide standardized adapter signatures in `agent/tools/` so both formats are normalized into clean observations for the LLM context.
