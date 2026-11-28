# Final Security Report

**Date:** 2026-11-25. This is a source/test assessment, not a penetration test or certification.

## Controls verified

- Stage 1 adversarial tests cover shell chaining/substitution/redirection, exact command approval, workspace traversal/symlinks, write race fixtures, terminal denial, provider code fail-closed behavior, local request Origin/Host checks, credential redaction, output bounds, timeout and child-process cancellation.
- Stage 5 tests cover registry schema/duplicate rejection, capability denial, approval, output caps/redaction, MCP stdio schema/cancellation/timeout, skill symlink handling and executable extension fail-closed behavior.
- Stage 6 tests cover stale-hash edits, safe repository traversal, read-only Git inspection and RAG citation escaping.
- Stage 7 added an ownership regression: a manifest PID without an in-memory `ChildProcess` reference is not terminated. Process registration now requires a real child handle. Exit cleanup no longer deletes the persisted manifest merely because the current process exits.
- Local HTTP server binding is loopback. Host/Origin validation is defense against browser-origin access, not authentication against same-user local processes.

## Remaining security limits

- **No OS sandbox:** terminal and MCP processes run with the current user's permissions. There is no Windows Job Object, restricted token, AppContainer, container/VM, network restriction or filesystem mount isolation. Node `vm` is not a security boundary. Arbitrary provider code and executable extensions remain disabled.
- **Process trees:** the lifecycle manager can terminate its registered direct child, but descendants are not contained by a Job Object and may outlive it. Resource quotas are not enforced by an OS boundary.
- **Same-user local API:** a local process running as the current user can call loopback APIs. Origin checks do not solve this.
- **Filesystem races:** PathGuard and atomic temporary replacement reduce risk but do not provide handle-based, race-free containment against a concurrent same-user process.
- **Runtime split:** Stage 3's single canonical lifecycle runtime is not verified. The Harness path uses the Tool Gateway, while local chat/media workflows retain separate orchestration.
- **Persistence/provider gaps:** no Stage 4 canonical event store/recovery/provider gateway; no exact-once recovery semantics or safe model fallback contract.
- **Logging:** scrubbers reduce common credential leakage, but regex redaction can miss novel secret formats. Raw request/stack traces and retention behavior need further audit.
- **Server response headers:** the main server still emits wildcard CORS headers in response helpers/assets. Request validation rejects hostile origins before route execution, but the header strategy should be consolidated with authenticated client ownership before any remote exposure.

## Stage 7 change

Previously, `terminate(id)` could fall back to a PID read from the persisted process manifest and use `taskkill`/`process.kill`; the exit handler could also delete that manifest. Stage 7 removed manifest-only termination authority, made registration reject bare PIDs, gated shutdown on an owned ChildProcess handle, and preserved the manifest on exit. The replacement intentionally does not claim descendant cleanup.

## Verification and scope

`node --test` for Stage 1, Stage 5, Stage 6, Stage 7 process ownership, issue regressions and model-kind passed 70 tests. Separate workspace, usage, analytics and Stage 11 route/provider-adjacent suites passed 27 tests. The full provider adapter suite could not connect to its own loopback fixture because the execution environment denied socket access (`EACCES`). Stage 12's real search test and the destructive legacy `test/agent_harness_test.js` were not run. No live browser, model, media backend or hostile external client penetration test was completed.

## Security posture

Useful local controls are present, but the project is not ready to claim that arbitrary autonomous execution is isolated, recoverable, or safe against same-user adversaries. Keep terminal actions approval-bound, executable extensions disabled, and remote binding disabled.
