# Stage 1 Security Report

**Date:** 2026-11-25  
**Scope:** Abyx security foundation and execution boundaries only. Runtime redesign, provider refactoring, and new features were not started.

## Summary

The critical shell bypass and alternate tool-dispatch paths were closed; untrusted provider code now fails closed instead of being run inside Node.js `vm`. Filesystem writes use guarded paths and same-directory exclusive temporary files with immediate revalidation. The local server binds to loopback and rejects hostile Host/Origin context. Cancellation now reaches underlying child processes and network fetches, with bounded output and process-tree cleanup.

A real Windows OS sandbox (restricted token, AppContainer, Job Object policy, or disposable container/VM) was not available in this checkout and was not falsely represented as implemented. Arbitrary untrusted code execution is disabled. Explicitly approved terminal commands remain host execution under the user's account and are not isolated. Filesystem checks reduce traversal and symlink risk, but Node path APIs cannot guarantee race-free protection from a concurrent same-user process replacing a path between the final check and OS mutation.

## Findings verified and addressed

- **G-01 shell authorization:** Replaced shell-prefix classification with structured executable/argument parsing, a known-executable allowlist, exact safe-command categories, default deny for unknown executables, and explicit approval for other allowed host commands. Shell metacharacters, control characters, chaining, pipes, substitutions, and redirection are rejected. Execution uses `spawn` with `shell:false`, sanitized environment, capped output, and bounded time. Approval is one-time, expires, and is tied to the exact command and normalized working directory. Policy and path are checked again immediately before spawn.
- **G-02 filesystem security:** Canonical workspace containment, sensitive-path denial, lstat/realpath component checks, nested missing-path ancestor validation, and symlink/junction rejection are applied at filesystem mutation entry points. Writes use exclusive random temporary files in the destination directory, flush data, revalidate, then rename. Failed backup or validation refuses the mutation. Upload/source writes also use guarded paths and bounded request handling.
- **G-03 process isolation:** Provider `run_code` is disabled and returns `isolated:false`; legacy harness dispatch is disabled. UI language distinguishes unavailable OS isolation from host terminal execution. No claim is made that Node `vm` is an OS boundary. Approved host commands have no CPU/memory/job-object isolation guarantee.
- **G-04 unified authorization:** The active agent execution path checks policy and approval; terminal execution independently rechecks and consumes the exact approval. Direct terminal API has a separate exact approval round trip. Session-wide wildcard grants were removed. Harness consumer dispatch and the legacy loop cannot bypass the policy path because they fail closed.
- **Local service:** The server forces loopback binding, validates Host/Origin/fetch-site context before routing, rejects cross-origin requests, bounds the protected upload route, and sanitizes returned errors. Credential-like environment keys are removed from child-process environments. Shell-based Windows batch launching was removed from the silent process runner.
- **G-06 cancellation:** Request/response disconnects propagate `AbortSignal` to terminal and browser work; fetch abort destroys its request. The process runner enforces timeout and output limits and kills a process tree (Windows `taskkill /T /F`; POSIX process group). Temporary process scripts were removed. Stale process records are no longer treated as sufficient authority to kill a PID.

## Security architecture

1. Request boundary validates local Host/Origin and request context before routes.
2. Tool request passes through one policy engine. Unknown executable is denied; exact safe read-only forms may run without approval; state-changing/other allowlisted host commands require a short-lived, single-use approval.
3. The terminal tool parses arguments without a shell, resolves and validates the working directory, checks the approval binding and policy again, then starts the child with a reduced environment, timeout and output cap.
4. Filesystem tools resolve paths under approved roots, reject sensitive or symlinked components, use guarded temporary writes and validate again at mutation time.
5. Untrusted provider code has no execution provider. Browser fetches are abortable and public-fetch guarded.

## Files changed

Application changes: `agent/policy_engine.js`, `agent/tools/terminal_tool.js`, `agent/tools/browser_tool.js`, `agent/path_guard.js`, `agent/tools/fs_tool.js`, `agent/index.js`, `agent/execution_loop.js`, `harness/plugins/provider_sandbox.js`, `harness/plugins/provider_terminal.js`, `harness/plugins/consumer_tools.js`, `harness/seams.js`, `harness/agent_seam.js`, `services/silent_process.js`, `services/universal_file_generator.js`, `services/file_service.js`, `services/study_service.js`, `services/obsidian_vault.js`, `services/process_lifecycle_manager.js`, `security/public_fetch.js`, new `security/local_server_guard.js`, `scripts/server/serve.cjs`, `scripts/server/harness_routes.cjs`, `scripts/server/cloud_routes.cjs`, `scripts/server/phase4_routes.cjs`, and frontend approval/status/API files `app/frontend/src/services/api.js`, `app/frontend/src/components/TerminalConsole.jsx`, `app/frontend/src/components/TextChat.jsx`, `app/frontend/src/components/HarnessManager.jsx`, `app/frontend/src/components/SecondBrainAbout.jsx`.

Verification artifact: new `scripts/tests/stage1_security.test.cjs`. Documentation: this report and `IMPLEMENTATION/README.md`.

## Tests executed

Command: `node --test scripts/tests/stage1_security.test.cjs`

Result: **17 passed, 0 failed**. Targeted `node --check` passed for all changed JavaScript/CJS implementation and security-test files. The Vite production frontend build completed successfully into a unique temporary directory (the existing `app/dist` was left untouched); Vite emitted its existing large-chunk advisory for the main bundle. Cases cover shell grammar and injection forms, default-deny classification, exact/expired/replayed approval, direct API approval, traversal and symlink escapes, nested missing descendants, exclusive/guarded writes, parent swap at the temporary-file boundary, no spawn before approval, one-time approved execution, fail-closed provider execution, hostile Host/Origin and error redaction, environment credential stripping, abort, child-tree termination, output flood limits, and local runtime process capability.

The parent-swap check validates the implemented revalidation boundary but does not prove immunity to every concurrent filesystem race. Only the focused stage test file was run; the legacy broad tests were intentionally not run because their cleanup/network behavior can affect existing user data.

## Failed tests

None in the final focused test run. During development, the output-flood test first exposed that the process runner counted captured rather than received bytes; that accounting was corrected and the test now passes. An earlier cancellation check also exposed delayed completion; the process termination path was corrected and abort and child-tree tests now pass.

## Remaining risks and limitations

- There is no OS-level sandbox for approved terminal commands. They can access anything available to the logged-in account, subject to the command policy and explicit approval. No Job Object resource limits, restricted token, AppContainer, VM/container boundary, or network isolation is configured.
- Same-user local processes can call loopback APIs; there is no authentication token. Loopback binding and browser origin checks mitigate remote exposure and browser CSRF, but do not establish caller identity against local software.
- Path revalidation and symlink checks reduce path attacks, but Node's path-based operations are not handle-relative atomic operations. A concurrent actor with the same account may still race the final check. Stronger guarantees require OS-specific handle-based operations or running in a separately isolated account/container.
- Some internal model/media generation and trusted application management writes are outside the user-facing filesystem tool boundary. They were not comprehensively migrated in this stage; the report scope does not certify all internal application file writes.
- The 64 MB general JSON limit remains; only the reviewed multipart upload path is capped at 20 MB. Other request-heavy endpoints may need dedicated limits.
- Windows `.cmd`/`.bat` tools may not execute through `shell:false`; this is a compatibility limitation, not a reason to re-enable shell interpretation.
- Allowlisted programs such as Node, Python, npm, Git, and package managers remain powerful when explicitly approved. Approval is authorization, not containment.

## Recovery instructions

- Preserve all existing user changes and generated outputs. Do not use `git reset`, `git clean`, or restore the entire worktree to undo Stage 1.
- To review the implementation, inspect the Stage 1 paths listed above and the focused test. To revert Stage 1, selectively reverse only the Stage 1 edits after reviewing the current diff against the pre-stage working tree; retain any unrelated pre-existing changes and untracked files.
- If an application regression requires immediate containment, keep provider code execution disabled and avoid approving terminal commands until the affected policy/path change is reviewed. The local service can be stopped normally; it now binds only to loopback.
- Stage 2 has not been started. Wait for explicit authorization before continuing.


