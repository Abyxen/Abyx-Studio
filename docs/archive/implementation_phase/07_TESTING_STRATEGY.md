# Testing Strategy

## Stage 0 baseline

Performed: syntax-parse check of 101 JS/CJS/MJS files (0 failures); parse 6 JSON files (0 failures); read-only Git inventory; one pure PolicyEngine classification probe. Not performed: tests/build/UI launch, provider/network/PDF/media/DB operations, race reproduction. Existing test file `test/agent_harness_test.js` deletes `test/temp_workspace` at startup and exit; that directory contains untracked user files and backup. Avoid it unless rewritten to use a unique temp folder under OS temp.

## Required layers

1. **Unit:** policy decision table; exact command parser; PathGuard canonical component handling; tool argument schemas; run state transitions; provider normalization; context budgeting; session serialization; process identity validation.
2. **Integration:** HTTP route + SSE with stub provider; approval pause/resume; cancellation; safe filesystem; tool gateway; provider failover; MCP stdio/HTTP mock; SQLite migration in temporary DB; session crash/replay.
3. **Security:** shell metacharacters across Windows cmd/PowerShell/Posix; symlink/junction/ADS/traversal; hostile Origin/Host/CSRF; process manifest PID reuse; extension side effects; MCP malicious schema/result; web SSRF redirects/DNS rebinding; prompt injection in files/RAG.
4. **Regression:** existing chat, local/cloud provider selection, model import/download, workspace active selection, file diff/write, voice/media route availability, automation pause/resume, RAG citations and app startup.
5. **UI:** keyboard-only approval/deny/cancel, accessible labels, loading/error/empty states, stream disconnect, diff previews, model fallback visibility, responsive layouts.
6. **Performance:** warm/cold startup; first token and full response; tool overhead; indexing time/recall; large workspace memory; process/resource lifecycle; UI responsiveness. Pin hardware/model/provider and report median/p95; do not compare model capability as harness latency.

## Non-destructive fixture rules

- Every filesystem/process test creates a unique temp root and verifies its resolved target before cleanup.
- Never use the repository's `test/temp_workspace` as scratch; never run cleanup against a shared `app/workspace`, `app/data`, or `.git` path.
- Use fake child processes and manifests for process-manager tests. No `taskkill`/`kill` against non-fixture PIDs.
- Stub provider/network/MCP calls by default. Explicit opt-in tests may use real service only with clear target and no user credentials in logs.
- Run migrations against a copied temporary DB; never the live app DB.
- Build/test output must go to a temporary output directory; do not overwrite dirty `app/dist` assets.

## Acceptance/exit gates

Prompt 1: every adversarial command/path/Origin test is denied or confined. Prompt 2: every agent entry path uses the same policy gateway and cancellation works. Prompt 3: crash/replay cannot duplicate side effects and provider contracts pass. Prompt 4: MCP and extensions have schema, auth, timeout and trust tests. Prompt 5: repository dirty state is preserved across multi-file edits. Prompt 6: jobs/processes recover and terminate only owned resources. Prompt 7: UI/accessibility and benchmark regression suites pass. A test that only sees a button or mocks the policy itself does not prove enforcement.
