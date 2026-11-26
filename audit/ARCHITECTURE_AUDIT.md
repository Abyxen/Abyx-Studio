# ABYX — ARCHITECTURE & REPOSITORY CLEANUP AUDIT

## 1. Repository Metrics
- **Total non-`node_modules` files inspected:** 1,005
- **Primary code files:** `.js` (149), `.json` (141), `.md` (124), `.jsx` (26), `.cjs` (22), `.ps1` (10), `.sh` (11)
- **Bundled binaries & models:** `.dll` (176), `.exe` (120)
- **Git Branch & Backup Verification:**
  - Active branch: `main` (`f03f48a`)
  - Backup branch: `backup/pre-erase-full-state` verified at commit `ddb63f71c726503e0f67b55c43770b82b0c7806e`
  - Working tree: Clean (`git status --short` empty prior to audit report creation)

## 2. Legacy vs New Architecture Coexistence
The repository cleanup requirement (`SECTION 3`) is **PARTIAL**. While the `agent/` subsystem was built cleanly, legacy modules and artifacts remain wired and present:

1. **`scripts/server/serve.cjs` Dual Wiring:**
   - Line 73: `aiProviders = require(path.join(ROOT, "services", "ai_providers.js"));`
   - Line 137: `subagents = require(path.join(ROOT, "services", "subagents.js"));`
   - Legacy `services/` remains active alongside `agent/`.
2. **Duplicate Agent Execution Loops in `agent/index.js`:**
   - `createAgentEngine()` instantiates both `runtimeController` (`RuntimeController` at `agent/runtime_controller.js`) and `executionLoop` (`AgentExecutionLoop` at `agent/execution_loop.js`).
3. **Unused Frontend Dependencies (`app/frontend/package.json`):**
   - Lists `@tauri-apps/api`, `@tauri-apps/plugin-opener`, and `@tauri-apps/cli` even though `app/frontend/src-tauri` does not exist.
4. **Missing Root `package.json`:**
   - No root `package.json` exists. Node.js backend relies purely on built-in modules (`node:sqlite` requiring `--experimental-sqlite` on Node v22.12.0) and Python helper scripts.

## 3. Architectural Layer Summary
- **Runtime:** Custom JS implementation (`RuntimeController`, `SessionManager`, `ModelAdapter`, `ProviderRegistry`, `EventNormalizer`, `CancellationManager`). `@earendil-works/pi-coding-agent` is not installed. **Defect:** `RuntimeController` crashes when constructed by `createAgentEngine()` because `ExecutionLogger` lacks `recordEvent()`.
- **Context:** `ContextManager` implements token budgeting, dynamic skill/memory/instruction loading, tool-output truncation, and middle-message compaction while preserving `session.transcript`.
- **Orchestration:** Native `Orchestrator` + `TaskScheduler` + `WorkflowCheckpointer` (SQLite). `@langchain/langgraph` is not installed. Live 3-agent DAG execution works over `POST /api/orchestrator/run`.
- **Memory & Skills:** `MemoryManager` (SQLite WAL) + `SkillEngine` (`SKILL.md`). FTS5 is disabled (`ftsEnabled: false`) on this Node SQLite build.
