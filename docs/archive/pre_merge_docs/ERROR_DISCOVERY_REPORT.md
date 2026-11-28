# ABYX — ERROR DISCOVERY REPORT
**Date:** 2026-11-26  
**Audited Baseline Commit:** `3d29082084dc7ed6172e6e4d5d8d073f629939ac`  
**Remediation Branch:** `remediation/system-stabilization`  

---

## 1. Discovered Defect Inventory

| Defect ID | Category | Severity | Affected Component | File & Line | Summary Description |
|---|---|---|---|---|---|
| **DEFECT-SEC-01** | Security | CRITICAL (P0) | `TerminalTool` / `SandboxManager` | `agent/tools/terminal_tool.js:52, 84-88`, `agent/security/sandbox_manager.js:136` | `TerminalTool.runCommand` signature omits `env`, ignoring sanitized environment passed by sandbox and spreading `...process.env`, leaking host secrets into child shells. |
| **DEFECT-RUN-01** | Runtime | CRITICAL (P0) | `RuntimeController` / `ExecutionLogger` | `agent/runtime_controller.js:121`, `agent/execution_logger.js:35` | `RuntimeController` calls `this.logger.recordEvent()`, but `ExecutionLogger` does not expose `recordEvent()`, causing turn 1 crash with `TypeError`. |
| **DEFECT-BRW-01** | Browser Tool | HIGH (P1) | `BrowserTool` | `agent/tools/browser_tool.js:270-286` | When `playwright` is not installed, `BrowserTool.interact` returns simulated success (`simulated: true`), violating no-fabrication directives. |
| **DEFECT-BRW-02** | Browser Tool | HIGH (P1) | `BrowserTool` | `agent/tools/browser_tool.js:225-248` | `BrowserTool.captureScreenshot` fails with `"Playwright browser binary not installed"`. Lacks standalone screenshot fallback (e.g. via Chromium/Edge headless CLI). |
| **DEFECT-FS-01** | Filesystem Tool | MEDIUM (P1) | `FsTool` | `agent/tools/fs_tool.js` | Missing `renameFile`, `moveFile`, and `copyFile` methods expected by filesystem specifications and tests. |
| **DEFECT-LSP-01** | LSP Tool | MEDIUM (P2) | `LspTool` | `agent/tools/lsp_tool.js` | In-process `vm.Script` and regexes provide syntax checks but lack document synchronization, definition jumps, and LSP protocol support. |
| **DEFECT-TST-01** | Test Suite | HIGH (P1) | `agent/index.js` exports | `agent/index.js:183`, `scripts/tests/stage12_harness_capabilities.test.cjs:19, 35` | `agent/index.js` does not export `WorkspaceFsTool` (or aliases for `FsTool`), breaking stage 12 test initialization. |
| **DEFECT-TST-02** | Test Suite | HIGH (P1) | Test Import Paths | `scripts/tests/stage6_agent_capabilities.test.cjs:13` | Test imports `../../services/context_manager` which moved to `../../agent/context_manager`, throwing `MODULE_NOT_FOUND`. |
| **DEFECT-TST-03** | Test Suite | HIGH (P1) | Tool Registry & Validator | `scripts/tests/stage5_extensibility.test.cjs:24`, `extensions/manifest_validator.js:139` | `ToolRegistry` export/constructor mismatch; `validateSchemaDefinition` is not a function in `manifest_validator.js`. |
| **DEFECT-TST-04** | Test Suite | MEDIUM (P1) | FsTool Method Names | `scripts/tests/workspaces_stage10.test.cjs:142` | Test calls `fsTool.write()` instead of the actual method `fsTool.writeFile()`. |
| **DEFECT-TST-05** | Test Suite | MEDIUM (P1) | Security Test Interfaces | `scripts/tests/stage1_security.test.cjs:102, 152` | Stale method names (`tool.write`, `terminal.execute`, `policy.authorizeTerminalApiRequest`) fail assertions. |
| **DEFECT-MEM-01** | Memory | LOW (P2) | `MemoryManager` | `agent/memory/memory_manager.js:22` | SQLite FTS5 disabled in bundled Node `node:sqlite` build; needs robust LIKE/JSON fallback without crashing search. |
| **DEFECT-SKL-01** | Skills | MEDIUM (P2) | `SkillEngine` / Server | `agent/skills/skill_engine.js`, `scripts/server/serve.cjs` | Live server reports 0 skills because default core skills are not automatically staged into the runtime skills directory. |
| **DEFECT-BNCH-01** | Benchmark | HIGH (P1) | Benchmark Execution | `benchmarks/reports/TASK_LEVEL_RESULTS.json` | 275 tasks defined in catalog, but all 275 recorded as `not_run`. Real benchmark execution suite must execute and record tasks. |
