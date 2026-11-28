# Coding Agent Capabilities

## Present

Workspace selection and management are in `services/workspace_service.js`; read/list/search/write operations are exposed in `agent/tools/fs_tool.js` and many routes in `harness_routes.cjs`/`serve.cjs`. File writes use temporary paths, backup copies, and generated diffs. Terminal execution captures stdout/stderr, timeout and cancellation. Browser/search can support documentation research. `DiffViewer.jsx`, `TerminalConsole.jsx`, `InsideBrowser.jsx`, `HarnessManager.jsx` and `TextChat.jsx` provide user-facing pieces. Source evidence does not show robust language-server indexing, repository maps, structured Git commands, patch application with context matching, test selection, or a safe recovery/undo stack.

## Important limits

`PathGuard` restricts requested file paths but not shell process behavior. `exec` accepts shell metacharacters and cwd is not confinement. The extension sandbox's Node `vm` does not constrain filesystem/network access robustly; Python uses the same host user. File backup errors are swallowed in `fs_tool.js`, and replacement via rename behavior differs by platform. Concurrent file edits can race despite optional mtime checks. `PathGuard` blocks `.git`, which prevents safe native repository inspection through that tool.

## Target workflow

Read-only discovery → concise plan → edits in a patch/diff staging layer → show changed files and exact diff → run user-approved tests in an OS sandbox → present results and failure logs → allow revert/accept. Add repository map/search and ignore rules; never index secrets/build output by default. Build safe Git status/diff first, then branch/worktree capabilities with explicit approval and preservation of uncommitted changes. Compare OpenCode and Pi coding tools for interaction patterns, not as evidence Abyx already has them. See G-01–G-03 and G-12.
