# ABYX — FAILED & BROKEN TESTS

| Failure ID | Affected Component | Exact Failure / Error Message | Root Cause Location |
|---|---|---|---|
| **FAIL-01** | `RuntimeController` | `TypeError: this.logger.recordEvent is not a function` | `agent/runtime_controller.js:121:21` calls `recordEvent`, but `ExecutionLogger` (`agent/execution_logger.js`) only provides `constructor` and `scrub`. |
| **FAIL-02** | `SandboxManager` / `TerminalTool` | Environment variable leak (`AUDIT_SECRET_API_KEY=SECRET_LEAK_TOKEN_999`) | `agent/tools/terminal_tool.js:52, 84-88` ignores `env` parameter from `sandbox_manager.js:141` and spreads host `...process.env`. |
| **FAIL-03** | `BrowserTool.captureScreenshot` | `"Playwright browser binary not installed for headless screenshot."` | `agent/tools/browser_tool.js:243` executes `npx playwright screenshot` which fails without playwright. |
| **FAIL-04** | `BrowserTool.interact` | Fabricated tool call: returns `{ ok: true, simulated: true }` | `agent/tools/browser_tool.js:278-286` fakes DOM interaction when playwright is missing. |
| **FAIL-05** | `stage12_harness_capabilities.test.cjs` | `TypeError: WorkspaceFsTool is not a constructor` | `scripts/tests/stage12_harness_capabilities.test.cjs:35:18` attempts to import `WorkspaceFsTool` from `agent/index.js`, where it is not exported. |
| **FAIL-06** | `stage6_agent_capabilities.test.cjs` | `Error: Cannot find module '../../services/context_manager'` | `scripts/tests/stage6_agent_capabilities.test.cjs:13:28` imports outdated path; file is in `agent/context_manager.js`. |
| **FAIL-07** | `stage5_extensibility.test.cjs` | `TypeError: ToolRegistry is not a constructor` (5 subtests failed) | `scripts/tests/stage5_extensibility.test.cjs:24:20` mismatches `ToolRegistry` export/constructor signature. |
| **FAIL-08** | `workspaces_stage10.test.cjs` | `TypeError: fsTool.write is not a function` (3 subtests failed) | Test calls `fsTool.write()` instead of the implemented `fsTool.writeFile()`. |
| **FAIL-09** | `stage1_security.test.cjs` | Interface mismatches (`tool.write`, `terminal.execute`, `policy.authorizeTerminalApiRequest`) | Test invokes obsolete method names on `FsTool`, `TerminalTool`, and `PolicyEngine`. |
