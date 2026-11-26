# ABYX — MISSING FEATURES & GAPS

1. **Playwright Browser Automation (`MISSING` / `BROKEN`)**:
   - The `playwright` npm package and browser binaries (Chromium, Firefox, WebKit) are not installed.
   - `BrowserTool.interact()` falls back to returning `{ ok: true, simulated: true }`, which fabricates success without touching a browser.
   - `BrowserTool.captureScreenshot()` fails immediately with `"Playwright browser binary not installed"`.
2. **Pi Agent SDK (`@earendil-works/pi-coding-agent`) (`MISSING`)**:
   - The official package is not installed. A custom in-process JavaScript runtime was written instead, but has broken entrypoint wiring (`ExecutionLogger.recordEvent`).
3. **LangGraph.js (`@langchain/langgraph`) (`MISSING`)**:
   - The package is not installed. A custom in-process DAG scheduler (`TaskScheduler`) with SQLite persistence was implemented instead.
4. **Microsoft LSP Libraries (`vscode-languageserver-node`) (`MISSING`)**:
   - The package is not installed. `LspTool` uses Node's `new vm.Script(code)` for JS parse checking and regular expressions for class/function symbol extraction.
5. **Filesystem `rename_file`, `move_file`, `copy_file` (`MISSING`)**:
   - `agent/tools/fs_tool.js` does not implement dedicated rename, move, or copy methods.
6. **260 Unrun Benchmark Tasks (`PARTIAL`)**:
   - `catalog.json` defines 275 tasks, but 260 tasks have never been executed through the agent runtime.
7. **SQLite FTS5 Full-Text Search (`PARTIAL`)**:
   - `MemoryManager.ftsEnabled` evaluates to `false` because the bundled Node v22.12.0 `node:sqlite` build lacks FTS5 extension support.
