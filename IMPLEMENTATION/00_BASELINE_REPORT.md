# Baseline Report

Date: 2026-11-25. Repository: `C:\Users\abira\Documents\Local Ai studio Abyx`.

## Git state and user changes

- Branch: `main`
- HEAD: `4e7d59e9851b4da09489ebcafe2a8541bb6e03cf`
- At Stage 0 start: 14 tracked paths changed (agent security/fs/terminal; model config; four generated `app/dist` paths; HarnessManager/TextChat/API; harness routes/server). `git diff --stat` reported 1,086 insertions and 722 deletions, including generated output.
- Untracked implementation/test state includes `app/config/abyx-processes.json`, two new dist assets, `services/context_manager.js`, `services/process_lifecycle_manager.js`, `test/agent_harness_test.js`, and three files under `test/temp_workspace` (including `.abyx_backup`). The existing `AUDIT_REPORT/` contains 26 untracked files from the previous task.
- `app/dist/apple-touch-icon.png` was deleted in the final status of the previous audit and remains deleted; this agent did not delete it. Do not restore, clean, or overwrite any of these paths without explicit instruction.
- The inspected project inventory was 183 non-generated/non-dependency project files before the audit package; current catalogue is 209 (183 plus 26 audit files), excluding ignored `node_modules` and `app/dist` output. This is a catalogue count, not proof every source line was reviewed.

## Safe checks performed

- `node --check` on 101 `.js`, `.cjs`, and `.mjs` files: 0 syntax failures. This excludes JSX/TSX parsing and does not execute modules.
- JSON parse of 6 non-generated project JSON files with a parser that accepts empty property names: 0 invalid files.
- Non-executing PolicyEngine probe with `allowTerminal: true`: command string `git status; echo POLICY_PROBE` returned `riskLevel: SAFE`. The shell command itself was **not** executed.
- Read-only Git branch, HEAD, status, diff summary, untracked path and source-map searches.

## Tests deliberately not run

`test/agent_harness_test.js` begins by recursively deleting `test/temp_workspace`, then uses it as test data and deletes it again at exit. That directory contains untracked user/project data and backups. Other suites exercise web search, PDF generation, provider calls, database/workspace state and cleanup. No unit/integration suite, build, application launch, database migration or network/model operation was run. This avoids replacing existing data and leaves baseline behavior unclaimed.

## Confidence and boundary

Current code was inspected in the agent/policy/path, server routes, process lifecycle, tool/MCP/extension, provider, workspace, RAG, automation and logger paths; all 26 prior audit documents were loaded and cross-checked. Static checking covers all 101 discovered JS-family source files syntactically, not their behavior. Runtime, UI, OS-specific shell semantics, race windows, provider availability, media hardware and competitor parity remain unverified. Several prior findings are downgraded or corrected in 01.
