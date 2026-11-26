# ABYX — TOOL CAPABILITY AUDIT

| Tool Category | Tool / Operation | Implementation | Test Result | Status | Notes |
|---|---|---|---|---|---|
| Filesystem | `read_file`, `write_file`, `edit_file`, `apply_patch` | `agent/tools/fs_tool.js` | Executed & passed (`editFile` uses `target`/`replacement`) | VERIFIED | `PathGuard` enforced |
| Filesystem | `create_directory`, `list_directory`, `glob_files`, `search_files`, `search_content`, `file_metadata` | `agent/tools/fs_tool.js` | Executed & passed | VERIFIED | None |
| Filesystem | `rename`, `move`, `copy` | Missing from `FsTool` | `typeof fsTool.renameFile === 'undefined'` | MISSING | Not implemented in `FsTool` |
| Terminal | `run_command`, `run_powershell`, timeouts, exit codes | `agent/tools/terminal_tool.js` | `Write-Output "TERM_OK"` passed; 400ms timeout killed sleep | VERIFIED | Ignores passed `env` object (security bug) |
| Terminal | `run_wsl` | `agent/tools/terminal_tool.js:139` | `wsl.exe` not installed on host | NOT APPLICABLE | Host lacks WSL2 |
| Developer | `git_status`, `git_diff`, `git_log`, `git_branch`, `git_worktree`, `run_tests`, `run_build` | `agent/tools/developer_tool.js` | Verified via test suite & runner | VERIFIED | None |
| Browser | `navigate_browser`, `inspect_dom`, `extract_browser_content` | `agent/tools/browser_tool.js` | `navigate` to `127.0.0.1:1420/api/health` returned 200 | PARTIAL | Plain HTTP GET + regex HTML-to-MD; no JS rendering |
| Browser | `interact_browser` | `agent/tools/browser_tool.js:254` | Returned `{ ok: true, simulated: true }` | BROKEN | `playwright` not installed; returns simulated success |
| Browser | `capture_screenshot` | `agent/tools/browser_tool.js:225` | Failed: `"Playwright browser binary not installed"` | BROKEN | Cannot capture screenshots |
| LSP | `diagnostics`, `symbols`, `find_definition`, `find_references` | `agent/tools/lsp_tool.js` | JS syntax & JSON validation passed; 1 symbol extracted | PARTIAL | Uses `vm.Script` + regex, not `vscode-languageserver-node` |
| Documents | PDF generation & inspection | `scripts/pdf_builder.py`, `pypdf` | Generated `42,626` byte PDF | VERIFIED | Uses Python `fpdf2` |
| Archives | ZIP / TAR generation | `scripts/archive_builder.py` | Generated `1,041` byte ZIP | VERIFIED | Python `zipfile`/`tarfile` |
| Documents | DOCX, XLSX, PPTX creation/editing | None | `python -c "import docx, openpyxl, pptx"` -> all `MISSING` | MISSING | No Office generation support |
| Integrations | MCP client & stdio manager | `services/mcp_client.js`, `services/mcp_stdio_manager.js` | Code present; no live MCP server configured | UNVERIFIED | Not tested against live MCP server |
