# ABYX — MISSING FEATURES

1. **DOCX Creation & Editing (`MISSING`)**: `python-docx` is not installed and `services/universal_file_generator.js` has no `.docx` handler.
2. **XLSX Spreadsheet Creation & Formula Analysis (`MISSING`)**: `openpyxl` / `xlsx` / `exceljs` are not installed; no `.xlsx` generator exists.
3. **PPTX Presentation Creation (`MISSING`)**: `python-pptx` / `pptxgenjs` are not installed; no `.pptx` generator exists.
4. **Playwright Browser Automation (`MISSING` / `BROKEN`)**: `playwright` npm package and browser binaries are not installed. `BrowserTool.interact()` returns simulated responses and `captureScreenshot()` fails.
5. **Pi SDK (`@earendil-works/pi-coding-agent`) (`MISSING`)**: Not installed; replaced by custom JS runtime.
6. **LangGraph.js (`@langchain/langgraph`) (`MISSING`)**: Not installed; replaced by custom SQLite DAG scheduler.
7. **Microsoft LSP (`vscode-languageserver-node`) (`MISSING`)**: Not installed; replaced by `vm.Script` + regex scanning.
8. **Filesystem `rename`, `move`, `copy` (`MISSING`)**: Not implemented on `FsTool` (`agent/tools/fs_tool.js`).
9. **56 Additional Benchmark Tasks (`MISSING`)**: `benchmarks/tasks/benchmark_tasks.json` defines 44 tasks rather than the required 100.
10. **SQLite FTS5 Active Indexing (`PARTIAL`)**: `MemoryManager.ftsEnabled` is `false` on this Node v22.12.0 `--experimental-sqlite` build.
