# ABYX Unified AI Studio — Merge Implementation Plan

**Canonical Root:** `C:\Users\abira\Documents\Local Ai studio Abyx`  
**Execution Date:** 2026-11-26  

---

## Staged Execution Roadmap

### Stage 1: Dependency & File Integration
1. Update `package.json` in `Local Ai studio Abyx` to include `playwright` and `ws`.
2. Install npm dependencies cleanly in `Local Ai studio Abyx`.
3. Copy Python document generator suite from `Open Abyx/src/tools/python_doc_tools.py` into `Local Ai studio Abyx/services/python_doc_tools.py`.
4. Copy Playwright browser tool, research tool, and process manager into `Local Ai studio Abyx/agent/tools/`.
5. Copy verification hooks, Automated Judge, and structured error feedback into `Local Ai studio Abyx/agent/verification/`.
6. Copy trajectory tracer and checkpoint rollback manager into `Local Ai studio Abyx/agent/`.

### Stage 2: Tool Registry & Gateway Unification
1. Register all newly imported tools into `agent/tool_registry.js`:
   - `python_doc`: Generates PDF, DOCX, XLSX with formulas, PPTX, Images, and SHA-256 ZIPs.
   - `playwright_browser`: Headless Chromium navigation, clicking, typing, scrolling, DOM query, screenshots.
   - `process_manager`: Detached background processes, synchronous append log streams, cancellation.
   - `internet_research`: Multi-source web search and citation synthesizer.
   - `smart_file_editor`: Regex replacement, unified diffs, path jailing.
2. Ensure `agent/tool_gateway.js` dispatches each tool and audits calls into `ExecutionLogger` and `policy_engine.js`.

### Stage 3: Unified Agent Execution Loop Integration
1. Connect `agent/execution_loop.js` with the unified tool gateway.
2. Ensure `modelRouter.chat` passes tool schemas to the model (local llama-server on port 10086 or OpenAI/Claude/Gemini/Ollama).
3. Connect trajectory event logging, checkpoint creation, and Automated Judge verification into the loop.

### Stage 4: API Gateway & Remote Access Integration
1. Add `services/api_gateway.js` combining REST endpoints (`/api/conversations`, `/api/tools`, `/api/settings`, `/api/health`) and WebSocket server (`ws://localhost:3001`).
2. Wire up the CLI runner `bin/abyx.js` so it can trigger autonomous agent workflows via CLI or start the API gateway.

### Stage 5: Testing, Benchmarking & Real E2E Validation
1. Port and execute all acceptance tests in `test/acceptance_merged.test.js`.
2. Execute the critical real-world workflow (Research -> Code -> Test -> Docs PDF/PPTX -> ZIP).
3. Verify zero VRAM harness overhead and stability across restarts.

### Stage 6: Cleanup & Final Documentation
1. Remove abandoned and temporary files.
2. Produce `UNIFIED_ARCHITECTURE.md`, `UNIFIED_TOOL_REGISTRY.md`, `FINAL_MERGE_REPORT.md`.
