# Known Limitations

## Runtime and persistence

- Stage 2/3/4 reports are absent; current source has not been shown to satisfy their canonical runtime, state machine, provider gateway, durable events or crash recovery contracts.
- Local text chat, the Harness agent, media workers, automations and subagents still have distinct orchestration paths. The Tool Gateway is not proof every product path shares one lifecycle.
- Chat history, profile/session data, usage, run JSON and automations remain multiple stores. No crash-safe replay guarantee exists; do not automatically repeat a destructive tool call after a restart.
- Session ownership, checkpoint recovery, approval history and diagnostic export are incomplete.

## Execution and process safety

- No OS-level sandbox restricts approved terminal/MCP code. It runs under the current Windows user's permissions; untrusted provider execution and executable extensions remain disabled.
- Process termination now requires a registered ChildProcess reference. Descendants are not managed through Job Objects and can outlive their parent. CPU, memory, network and disk quotas are not enforced.
- Same-user local processes are not authenticated at the HTTP API. Loopback and Origin/Host checks do not protect against a same-user process.
- Path checks are not fully race-free against a concurrent same-user process.
- Test execution, Git staging and Git commits are unsupported. Git tools added in Stage 6 are read-only.

## Product capabilities

- Multi-file transactional edits, explicit patch-set recovery, branch/worktree management, semantic repository embeddings and broad RAG quality evaluation are incomplete.
- Persistent project memory, user-facing memory proposal history, durable background jobs and isolated subagents are absent.
- Provider adapters exist, but capability parity, explicit fallback exposure and all-provider cancellation/retry contracts are not fully validated.
- MCP HTTP/SSE transports, automatic reconnect and OS isolation are not delivered. Skill dependencies are metadata only; they are not installed automatically.
- AI Studio workers were not start/stop/restart tested on the user's GPU, and hardware/resource telemetry was not benchmarked.
- Keyboard, screen-reader, contrast and responsive UX were not validated in a live browser. CUA could not safely identify the current browser URL.

## Validation constraints and failures

- Frontend production build passed to a temporary directory. Backend start on port 1420 returned `EADDRINUSE`; shell loopback requests were denied by the execution environment. This prevented live frontend/backend integration checks.
- Provider tests that open a loopback mock server failed when `fetch` was denied with `EACCES`. Provider adapter behavior is therefore not fully covered here.
- `scripts/tests/stage12_harness_capabilities.test.cjs` performs real web search and was not run under restricted network access.
- `test/agent_harness_test.js` recursively deletes the shared `test/temp_workspace` and asserts obsolete APIs/behavior; it was not run.
- `issue-regressions.test.cjs` initially failed two stale source assertions. The test expectations now match the current PDF document handler and actual Windows launcher entrypoint; its final run passed.

## Current process manifest caution

The first backend validation attempt exited through the old process-manager handler, which removed `app/config/abyx-processes.json`. I restored the file using the contents captured before that attempt. At a later read it had been repopulated with a newer LLM PID/model record, presumably by the already-running application; I left that newer content untouched and did not terminate any process. Check the current process and manifest relationship manually if it no longer corresponds to the running model.
