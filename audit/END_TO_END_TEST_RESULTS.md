# ABYX — END-TO-END & ISOLATED TEST RESULTS

## 1. Existing Regression Suite (11 Test Files)
Executed via `app\tools\node-win\node.exe --experimental-sqlite --test`:
- `test/agent_harness_test.js`, `context_engine_test.js`, `multi_agent_system_test.js`, `qa_failure_scenarios_test.js`, `tool_ecosystem_test.js`, `security_isolation_test.js`, `orchestration_system_test.js`, `unified_runtime_test.js`, `memory_skills_test.js`, `verification_benchmark_test.js`, `frontend_integration_test.js`
- **Result:** **66 tests, 66 passed, 0 failed** (duration: 8,572ms).

## 2. Independent Audit Tests (Section 9 & Isolated Temp Suite)
| Test | Scope | Result | Status |
|---|---|---|---|
| Runtime Live Session (`createAgentEngine`) | `engine.runtimeController.runSession()` | Crashed: `this.logger.recordEvent is not a function` | BROKEN |
| Runtime Live Session (`logger: null`) | Direct `RuntimeController` | `ok: true, turnsCount: 1`, but `finalAnswer` returned `""` | PARTIAL |
| Context Compaction | 34 messages -> 2048 budget | Compacted to 6 messages (`1364` tokens); transcript preserved (`34`) | VERIFIED |
| Filesystem Tools | Write, Read, Edit, Glob, Search | All passed; `rename/move/copy` missing | PARTIAL |
| Terminal & Timeout | PowerShell + 400ms timeout | `TERM_OK` printed; `Start-Sleep 5` killed (`timeoutKilled: true`) | VERIFIED |
| LSP Tool | Valid/Invalid JS + Symbols | Diagnostics & symbol count accurate (regex/`vm.Script`) | PARTIAL |
| Browser Automation | Navigate, Interact, Screenshot | `navigate` 200 OK; `interact` simulated; `screenshot` failed (no Playwright) | BROKEN |
| Security Adversarial | Path traversal, `format C:` (`turbo`), env leak | Traversal & `format C:` blocked; **`AUDIT_SECRET_API_KEY` leaked** | BROKEN |
| Multi-Agent DAG (Test E) | 3-agent pipeline (`planner -> developer -> reviewer`) via `/api/orchestrator/run` | HTTP 200 SSE completed in 14,775ms against `AbyxV2 9B.gguf` | VERIFIED |
| Memory & Skills | Project dedup, isolation, FTS5, `SKILL.md` | Dedup & isolation pass; `ftsEnabled: false`; live `/api/agent/skills` = 0 | PARTIAL |
| PDF & ZIP (Test B partial) | `pdf_builder.py`, `archive_builder.py` | Valid PDF (`42,626 B`) & ZIP (`1,041 B`) created; DOCX/XLSX/PPTX missing | PARTIAL |
| Challenge A App (Test A) | `benchmarks/challenges/challenge_a_task_manager` | SQLite CRUD unit test passed (`1/1`) | VERIFIED |
