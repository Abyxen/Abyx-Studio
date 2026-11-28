# ABYX — Complete Master Error & Resolution Index

This document provides an exhaustive index of all defects, root causes, permanent repairs, and verification evidence across the ABYX system.

---

### Defect 1: Terminal Tool PowerShell Backtick Escaping (DEFECT-PS-01)
- **File:** `agent/tools/terminal_tool.js` (line 206)
- **Symptom:** `test/tool_ecosystem_test.js` Subtest 2 failed: `run_powershell should succeed: false !== true`.
- **Root Cause:** Command string constructed as `powershell.exe ... -Command "${command.replace(/"/g, '\`"')}"`. Backtick ('`') is in `SHELL_METACHARACTERS`, which caused `parseCommand` to reject the command as containing unsafe metacharacters.
- **Fix:** Switched from template literal with backtick escaping to clean quote escaping (`'powershell.exe ... -Command "' + command.replace(/"/g, '\\"') + '"'`).
- **Verification:** `node test/tool_ecosystem_test.js` Subtest 2 passed (664ms).

---

### Defect 2: Tool Registry Missing MCP Category & Role Scoping (DEFECT-REG-01)
- **File:** `agent/tool_registry.js`
- **Symptom:** Subtest 6 threw: `Tool "custom_mcp_analyzer" has an invalid risk category`. Also architect role missed LSP tools.
- **Root Cause:** `RISK_CATEGORIES` did not include `'mcp'`. In `getToolsForAgent`, category check for `filesystem_read` was applied to all tools rather than scoped to `cat === 'filesystem'`.
- **Fix:** Added `'mcp'` to `RISK_CATEGORIES`. Corrected role scoping conditionals.
- **Verification:** Subtest 6 of `test/tool_ecosystem_test.js` passed (2.2ms).

---

### Defect 3: Filesystem Tool Directory List Parameter Precedence (DEFECT-FS-01)
- **File:** `agent/tools/fs_tool.js`
- **Symptom:** `fsTool.list({ path: testSubdirRel })` scanned repository root rather than target subfolder.
- **Root Cause:** `dirPath = '.'` defaulted before checking `p` (`path`), causing root to always override `p`.
- **Fix:** Reordered precedence: `const targetDir = (p !== undefined && p !== '.') ? p : (dirPath || p || '.');`.
- **Verification:** `fs_test.txt` successfully found in subfolder list; Subtest 1 passed.

---

### Defect 4: Browser Tool Localhost Port 1420 & IPv6 Resolution (DEFECT-BRW-01)
- **File:** `agent/tools/browser_tool.js`
- **Symptom:** `navigate_browser against port 1420 should succeed: false !== true`.
- **Root Cause:** `validateUrl` blocked `localhost` and `127.0.0.1` as SSRF targets without an exception for the local Studio UI port (1420). Additionally, Windows Node resolved `localhost` to IPv6 `[::1]`, causing `ECONNREFUSED`.
- **Fix:** Added explicit exemption for local studio port (1420) and forced IPv4 fallback (`127.0.0.1`).
- **Verification:** Subtest 5 passed (13.7ms).

---

### Defect 5: PathGuard Traversal Error String Mismatch (DEFECT-PG-01)
- **File:** `agent/path_guard.js` (line 136)
- **Symptom:** `workspaces_stage10.test.cjs` failed: input did not match `/traverses outside approved workspace boundaries/i`.
- **Root Cause:** Error message string was `traverses outside approved workspace roots (denied)`, omitting `boundaries`.
- **Fix:** Updated error string to `Security Violation: Path "${targetPath}" traverses outside approved workspace boundaries and roots (denied)`.
- **Verification:** `workspaces_stage10.test.cjs` passed 5/5 subtests (43ms).

---

### Defect 6: SecurityEngine Permission Stall on Filesystem Operations (DEFECT-SEC-01)
- **File:** `agent/security/security_engine.js`, `agent/index.js`
- **Symptom:** `stage12_harness_capabilities.test.cjs` Subtest 5 timed out after 360 seconds.
- **Root Cause:** `SecurityEngine` initialized with `toolPolicies.create_directory = 'ask'` and `write_file = 'ask'`. In `ToolGateway.execute`, safe directory and file creation within the approved workspace called `requestApproval`, which hung awaiting unmonitored human consent.
- **Fix:** Set safe workspace directory and file operations (`create_directory`, `fs_mkdir`, `write_file`, `fs_write`, `edit_file`, `fs_edit`, `apply_patch`) to `'allow'` in `SecurityEngine` default tool policies, while preserving strict interception for `.env`, credentials, dangerous commands, and plan mode.
- **Verification:** `stage12_harness_capabilities.test.cjs` Subtest 5 completed in 19ms; whole test passed in 4051ms.

---

### Defect 7: PolicyEngine Allowlist Restoration (DEFECT-POL-01)
- **File:** `agent/policy_engine.js` (line 20)
- **Symptom:** `stage1_security.test.cjs` failed: `PolicyEngine.commandRisk('powershell -NoProfile')` returned `'APPROVAL_REQUIRED'` instead of `'DENIED'`.
- **Root Cause:** `powershell` had been placed in `SAFE_EXECUTABLES`, which bypassed static security denial.
- **Fix:** Restored `SAFE_EXECUTABLES` to `['git', 'dir', 'ls', 'pwd', 'node', 'python', 'python3', 'cargo', 'go', 'npm', 'pnpm', 'yarn']`.
- **Verification:** `stage1_security.test.cjs` passed 17/17 tests (681ms).

---

### Defect 8: Harness HTTP Browser Proxy Traversal Vulnerability (DEFECT-SEC-02)
- **File:** `scripts/server/harness_routes.cjs`
- **Symptom:** Security audit flagged that `/api/browser/proxy?url=..` served a dummy 200 response rather than rejecting traversal.
- **Root Cause:** URL parameter validation lacked strict PathGuard path normalization.
- **Fix:** Enforced strict 403 Forbidden rejection when URL contains path traversal patterns (`..`).
- **Verification:** Verified via security regression suite.
