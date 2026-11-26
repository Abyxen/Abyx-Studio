# ABYX — ARCHITECTURE & REPOSITORY CLEANUP AUDIT

## 1. Repository Metrics & Packaging
- **Active Git Commit:** `8f57415` (`feat(core): universal file generation, llama-server 32k ctx optimization, and standalone Electron desktop app with NSIS setup installer`)
- **Git Backup Branch:** `backup/pre-erase-full-state` verified at commit `ddb63f71c726503e0f67b55c43770b82b0c7806e`
- **Application Distribution:**
  - Standalone Executable: `dist-electron/win-unpacked/ABYX Unified AI Studio.exe` (250,417,664 bytes)
  - NSIS Setup Installer: `dist-electron/ABYX-Setup-1.0.0.exe` / `dist-electron/setup.exe` (145,785,412 bytes)
  - Root `package.json` configures `electron` and `electron-builder` with offline extraResources.

## 2. Legacy vs New Architecture Coexistence
The repository cleanup requirement (`SECTION 3`) is **PARTIAL**. While modern modules exist under `agent/`, legacy modules and duplicate execution paths persist:

1. **`scripts/server/serve.cjs` Dual Wiring:**
   - Line 73: `aiProviders = require(path.join(ROOT, "services", "ai_providers.js"));`
   - Line 137: `subagents = require(path.join(ROOT, "services", "subagents.js"));`
   - Legacy `services/` remains loaded in parallel with `agent/`.
2. **Duplicate Agent Execution Loops:**
   - `agent/index.js` instantiates both `runtimeController` (`RuntimeController` at `agent/runtime_controller.js`) and `executionLoop` (`AgentExecutionLoop` at `agent/execution_loop.js`).
3. **Dead / Unused Frontend Dependencies:**
   - `app/frontend/package.json` retains `@tauri-apps/api`, `@tauri-apps/plugin-opener`, and `@tauri-apps/cli` despite the removal of Tauri.

## 3. Architectural Layer Status

### 3.1 Agent Runtime
- **SDK Presence:** `@earendil-works/pi-coding-agent` is **NOT INSTALLED**. Replaced by a custom JavaScript runtime (`RuntimeController`, `SessionManager`, `ModelAdapter`, `ProviderRegistry`, `EventNormalizer`, `CancellationManager`).
- **Defect (`BROKEN`):** `RuntimeController` fails on turn 1 (`TypeError: this.logger.recordEvent is not a function` at `agent/runtime_controller.js:121`) because `ExecutionLogger` only provides `constructor` and `scrub`.

### 3.2 Context & Compaction
- **Implementation:** `ContextManager` (`agent/context_manager.js`) handles context window limits, token budgeting, tool output truncation, and dynamic pruning.
- **Verification:** An isolated 34-message test compacted context down to 6 messages (`1,364` tokens) while preserving the full conversation in `session.transcript` (`34` messages).

### 3.3 Orchestration & Multi-Agent Execution
- **Implementation:** Native `Orchestrator` (`agent/orchestrator.js`), `TaskScheduler` (`agent/scheduler.js`), `WorkflowCheckpointer` (SQLite).
- **LangGraph Presence:** `@langchain/langgraph` is **NOT INSTALLED**. The system uses a native Directed Acyclic Graph (DAG) with cycle detection.
- **Verification:** Live 3-agent orchestration (`planner -> developer -> reviewer`) via `POST /api/orchestrator/run` completed successfully in 14.7s against the local `AbyxV2 9B.gguf` model.

### 3.4 Memory & Skills Subsystem
- **Memory:** 3-tier memory (`session`, `project`, `persistent`) backed by SQLite WAL mode. Deduplication and project isolation are functional. FTS5 full-text indexing is disabled (`ftsEnabled: false`) in this Node v22.12.0 build.
- **Skills:** `SkillEngine` parses `SKILL.md` frontmatter and enforces permission constraints.
