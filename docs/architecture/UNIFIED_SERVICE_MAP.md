# ABYX Unified AI Studio — Service & Subsystem Map

## 1. Unified Service Directory

| Service Name | File Location | Responsibility | Ports / Protocols |
| :--- | :--- | :--- | :--- |
| **Electron Shell** | `electron/main.js` | Desktop window, native menus, backend process lifecycle, tray | Electron IPC |
| **Frontend Server & Static Host** | `scripts/server/serve.cjs` | Hosts React SPA (`app/dist`), proxies API calls, manages daemons | HTTP 1420 |
| **API Gateway** | `services/api_gateway.js` | REST routing for sessions, tools, plans, metrics, and security | HTTP 3000 |
| **WebSocket Event Server** | `services/websocket_server.js` | Real-time bi-directional agent events, terminal streaming, heartbeats | WS 3001 |
| **Local LLM Server** | `app/llm-backend/.../llama-server.exe` | High-throughput CUDA GGUF text generation for `AbyxV2 9B` | HTTP 10086 |
| **Process Manager** | `services/process_manager.js` | Detached daemon management, PID tracking, synchronized log files | In-process API |
| **Python Document Suite** | `services/python_doc_tools.py` | Binary document generation (PDF, DOCX, XLSX, PPTX, Images, ZIP) | CLI JSON IPC |
| **Database & Migration Engine** | `db.js`, `db_migrations.js` | SQLite persistence for chats, memories, profiles, checkpoints | Native SQLite |

---

## 2. API Endpoints Contract

### 2.1 Agent & Orchestration
- `GET /api/orchestrator/agents` — Returns list of specialized agent personas (Planner, Developer, Reviewer, Tester, etc.).
- `POST /api/orchestrator/run` — Executes a multi-agent DAG workflow and streams SSE lifecycle events.
- `GET /api/agent/policy` — Returns current policy mode (`plan` vs `build`), approved roots, and rule sets.
- `GET /api/agent/approvals` — Lists human-in-the-loop pending approval requests.
- `POST /api/agent/approve` — Resolves pending approval request (`{ approvalId, approved, reason }`).

### 2.2 Security & Isolation
- `GET /api/security/status` — Returns isolation tier (`Tier 1 / Workspaces`), approved root directories, and mode.
- `GET /api/security/workspaces` — Lists active task workspaces and file locks.
- `POST /api/security/lock` — Acquires exclusive file or workspace lock.

### 2.3 File & Terminal Operations
- `POST /api/files/read` — Reads content of a workspace-approved file.
- `POST /api/files/write` — Writes content to a workspace-approved file.
- `POST /api/files/diff` — Computes unified line-by-line diff between two strings or files.
- `POST /api/terminal/execute` — Executes a shell command within strict security guardrails.

### 2.4 Verification & Benchmarks
- `POST /api/verification/verify` — Executes deterministic file existence and content assertions.
- `GET /api/benchmark/tasks` — Catalogs standard benchmarks and evaluation tasks.
- `POST /api/benchmark/run` — Executes an automated benchmark evaluation and saves results.

---

## 3. Inter-Service Communication Flow

```
[React Frontend]
       │
  HTTP 1420 / SSE / WS 3001
       ▼
[scripts/server/serve.cjs] ───► [services/api_gateway.js]
       │                                │
       ▼                                ▼
[harness/openhands_orchestrator.js] ──► [agent/runtime_controller.js]
                                                │
                                    ┌───────────┴───────────┐
                                    ▼                       ▼
                           [agent/tool_gateway.js]  [agent/model_adapter.js]
                                    │                       │
                       ┌────────────┼───────────┐           ▼
                       ▼            ▼           ▼   [llama-server:10086]
                  [Terminal]   [Playwright]  [PythonDoc]
```
