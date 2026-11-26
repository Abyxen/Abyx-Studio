# ABYX — TOOL CAPABILITY AUDIT

| Tool Category | Tool / Operation | Implementation | Test Result | Status | Evidence & Notes |
|---|---|---|---|---|---|
| Filesystem | `read_file`, `write_file`, `edit_file`, `apply_patch` | `agent/tools/fs_tool.js` | Executed & passed | VERIFIED | `PathGuard` workspace boundary enforced |
| Filesystem | `create_directory`, `list_directory`, `glob_files`, `search_files`, `search_content`, `file_metadata` | `agent/tools/fs_tool.js` | Executed & passed | VERIFIED | Fast in-process glob & content search |
| Filesystem | `rename_file`, `move_file`, `copy_file` | Absent from `FsTool` | `typeof fsTool.renameFile === 'undefined'` | MISSING | Not exposed on `FsTool` class |
| Terminal | `run_command`, `run_powershell`, timeouts, exit codes | `agent/tools/terminal_tool.js` | `Write-Output "TERM_OK"` passed; 400ms timeout killed sleep | VERIFIED | PowerShell execution functional; ignores `env` param |
| Terminal | `run_wsl` | `agent/tools/terminal_tool.js:139` | `wsl.exe` check returned `available: false` | NOT APPLICABLE | Host Windows 11 lacks WSL2 distribution |
| Developer | `git_status`, `git_diff`, `git_log`, `git_branch`, `git_worktree`, `run_tests`, `run_build` | `agent/tools/developer_tool.js` | Git inspection & tests executed | VERIFIED | Clean interaction with local Git CLI |
| Browser | `navigate_browser`, `inspect_dom`, `extract_browser_content` | `agent/tools/browser_tool.js` | `navigate` to `127.0.0.1:1420` returned 200 | PARTIAL | Plain HTTP GET + HTML-to-MD; no JS rendering |
| Browser | `interact_browser` | `agent/tools/browser_tool.js:254` | Returned `{ ok: true, simulated: true }` | BROKEN | `playwright` not installed; fabricates success |
| Browser | `capture_screenshot` | `agent/tools/browser_tool.js:225` | Failed: `"Playwright browser binary not installed"` | BROKEN | Cannot capture real headless screenshots |
| LSP | `diagnostics`, `symbols`, `find_definition`, `find_references` | `agent/tools/lsp_tool.js` | JS syntax & JSON validation passed | PARTIAL | In-process `vm.Script` + regex, not real LSP |
| Documents | PDF generation & inspection | `scripts/pdf_builder.py` | Generated `51,024` byte PDF | VERIFIED | Built via Python `fpdf2` |
| Documents | DOCX document creation | `scripts/office_builder.py` | Generated `35,369` byte DOCX | VERIFIED | Built via `python-docx` |
| Spreadsheets | XLSX workbook & tables | `scripts/office_builder.py` | Generated `5,118` byte XLSX | VERIFIED | Built via `openpyxl` with header styling |
| Presentations| PPTX slide deck creation | `scripts/office_builder.py` | Generated `30,099` byte PPTX | VERIFIED | Built via `python-pptx` |
| Graphics | Raster image generation (PNG/JPG/ICO) | `scripts/office_builder.py` | Generated `5,933` byte PNG | VERIFIED | Built via Pillow (PIL) |
| Rich Text | RTF document generation | `services/universal_file_generator.js` | Generated `79` byte RTF | VERIFIED | Pure JS native RTF generator |
| Archives | ZIP / TAR archive packaging | `scripts/archive_builder.py` | Generated `149` byte ZIP | VERIFIED | Built via Python `zipfile`/`tarfile` |
| Integrations | MCP client & stdio manager | `services/mcp_client.js`, `services/mcp_stdio_manager.js` | Config loads; no external server connected | UNVERIFIED | Code present; lacks live test server |
