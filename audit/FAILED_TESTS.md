# ABYX — FAILED & BROKEN TESTS

| ID | Component | Failure / Defect | Evidence |
|---|---|---|---|
| FAIL-01 | `RuntimeController` + `ExecutionLogger` | `TypeError: this.logger.recordEvent is not a function` | `agent/runtime_controller.js:121` calls `recordEvent`; `ExecutionLogger` only has `constructor` and `scrub` |
| FAIL-02 | `SandboxManager` + `TerminalTool` | Environment variable sanitization bypassed; secret leaked to child shell | `AUDIT_SECRET_API_KEY=SECRET_LEAK_TOKEN_999` appeared in `stdout` because `TerminalTool.runCommand` (`agent/tools/terminal_tool.js:84`) ignores `env` param |
| FAIL-03 | `BrowserTool.captureScreenshot` | Fails with `"Playwright browser binary not installed for headless screenshot."` | `agent/tools/browser_tool.js:243` |
| FAIL-04 | `BrowserTool.interact` | Does not perform real DOM interaction; returns `{ ok: true, simulated: true }` | `agent/tools/browser_tool.js:278-286` |
| FAIL-05 | `GET /api/agent/sessions` | Returns `ok: false` when queried on running server | Live HTTP probe returned `SESSIONS: false` |
