# Security and Reliability Audit

Static review only; no penetration testing. Security-relevant current changes were already in the worktree and are not audit edits.

## Findings

**Critical design risk — shell command policy:** `agent/policy_engine.js` treats prefixes as safe read-only without full command parsing. With `exec()` shell interpretation, trailing `;`, `&&`, pipes or substitutions can turn a nominally safe prefix into a state-changing command. General terminal access is not confined to workspace by `cwd`. Do not rely on regex blocklists for command isolation.

**Critical design risk — path checks:** `agent/path_guard.js` includes traversal, secret pattern and symlink checks, which are useful defense-in-depth. For a missing path it checks only the immediate parent if that parent exists; unchecked missing ancestor chains and TOCTOU races remain. Path checks do not constrain child processes.

**Sandbox claims:** Node `vm.runInNewContext` is not a secure hostile-code sandbox; Python subprocess inherits user permissions. Require a real OS boundary for untrusted code or classify it as trusted local execution.

**Multiple tool pathways:** `HarnessAgentLoop` directly calls `consumer_tools.executeTool`, outside agent policy approvals. Extension code is `require()`d into server process. MCP tools are externally supplied capabilities. All must pass one policy boundary and trust lifecycle.

**Local HTTP boundary:** `serve.cjs` defaults to `127.0.0.1`, but JSON/SSE helpers set `Access-Control-Allow-Origin: *`, and `0.0.0.0` can be configured. UI has no login. Local-only is a deployment assumption; tighten Origin/Host/CSRF behavior and require authentication/explicit secure remote mode before network exposure.

**Reliability:** cancellation is not consistently plumbed to browser requests; session and run state are split; JSON session events use synchronous read/modify/write; approval maps are in memory; errors/retries are inconsistent across adapters.

## Required safeguards before broad agent use

1. Remove safe shell prefix allow rules; adopt exact executable/argument policy and OS isolation.
2. Correct symlink-safe filesystem operations and test concurrent create/edit behavior.
3. Gate every built-in, extension and MCP tool through a single typed authorization gateway.
4. Secure local server origin/auth boundary and make remote exposure opt-in with authentication.
5. Redact credentials and untrusted content in event logs; bound retention and output size.
6. Add kill-tree/resource limits and cleanup on cancellation, timeout, crash and shutdown.
7. Test denial, approval, timeout, disconnect, malicious paths, symlink races, shell metacharacters and prompt-injected tool results.

Evidence: `agent/policy_engine.js`, `agent/path_guard.js`, `agent/tools/terminal_tool.js`, `agent/tools/fs_tool.js`, `harness/agent_seam.js`, `harness/plugins/consumer_tools.js`, `extensions/plugin_runner.js`, `security/public_fetch.js`, `scripts/server/serve.cjs`.
