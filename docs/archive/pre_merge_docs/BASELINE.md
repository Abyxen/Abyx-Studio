# ABYX UNIFIED AI STUDIO — BASELINE ARCHITECTURAL RECORD
**Date:** November 2026  
**Repository Path:** `C:\Users\abira\Documents\Local Ai studio Abyx`  
**Active Git Branch:** `main`  
**Protected Safety Backup Branch:** `backup/pre-erase-full-state` (Commit: `ddb63f7`)  
**Production Host Runtime:** Windows 11 (AMD Ryzen 9 8940HX, 31 GB RAM, NVIDIA RTX 5060 Laptop GPU 8GB VRAM)  
**Authoritative UI Endpoint:** `http://localhost:1420`  
**Active Local Model Service:** `http://127.0.0.1:10086/v1/chat/completions` (`AbyxV2 9B.gguf`, 8.95B params, 256k context)

---

## 1. Baseline State & Phase 0 Verification

### 1.1 Git Checkpoint & Safety Protection
- **Permanent Backup:** Branch `backup/pre-erase-full-state` preserves the pre-erase working implementation at commit `ddb63f7`.
- **Integrity Rule:** `backup/pre-erase-full-state` is strictly read-only and will never be modified or deleted.
- **Current Branch:** `main` is at commit `ddb63f7` with harness deletion staging recorded.

### 1.2 Running Services & Startup Commands
- **Backend Server:**
  - Startup Command: `app\tools\node-win\node.exe --experimental-sqlite scripts\server\serve.cjs`
  - Port: `1420`
  - Function: Serves `app/dist/` production frontend bundle, SQLite persistence, and API routes.
- **Local LLM Engine:**
  - Binary: `app\llm-backend\win\cuda\llama-server.exe`
  - Model: `app\llm-models\AbyxV2 9B.gguf`
  - Port: `10086`
  - Features: Flash-attention on CUDA, Q4_0 KV cache, deepseek reasoning format (`reasoning_content`), 256k context.

### 1.3 Preserved Core Foundation Files
The following critical foundation files are protected and retained:
- `agent/model_router.js`: Unified model router connecting to `127.0.0.1:10086` with reasoning content extraction and DPAPI cloud fallback.
- `scripts/server/serve.cjs`: Primary backend server entrypoint.
- `app/frontend/src/components/MultiAgentWorkspace.jsx`: OpenCode 3-pane UI component.
- `app/llm-models/AbyxV2 9B.gguf`: Local model weights file.
- `security/credential_store.js`: Windows DPAPI secret vault for API keys.
- `db.js`: SQLite schema manager and database layer (`app/data/abyx_memory.db`).

---

## 2. Erased Subsystems Inventory (Awaiting Proper Reconstruction)

Per user directive, the following legacy and intermediate harness components have been deleted to enable clean, ground-up reconstruction:

1. **Context & Memory:**
   - `services/context_manager.js`
   - `services/memory_reviewer.js`
   - `agent/shared_memory.js`
   - `agent/event_store.js`
   - `agent/task_store.js`
2. **Tools Subsystem:**
   - `agent/tools/fs_tool.js`
   - `agent/tools/terminal_tool.js`
   - `agent/tools/lsp_tool.js`
   - `agent/tools/browser_tool.js`
   - `agent/tool_gateway.js`
   - `agent/tool_registry.js`
3. **Verification:**
   - `agent/verifier.js`
4. **Permissions & Sandboxes:**
   - `agent/policy_engine.js`
   - `agent/path_guard.js`
   - `agent/workspace_isolation.js`
5. **Agent Loops & Orchestration:**
   - `agent/execution_loop.js`
   - `agent/orchestrator.js`
   - `agent/scheduler.js`
   - `agent/message_bus.js`
   - `agent/agent_registry.js`

---

## 3. Exit Condition Met
Existing working foundation (local LLM on 10086, web server on 1420, Git history, and core model routing) is fully understood, protected by branch `backup/pre-erase-full-state`, and ready for Phase 1 cleanup and subsequent architectural reconstruction.
