# Stage 7 — Final Validation Report

**Date:** 2026-11-25  
**Outcome:** Partial stabilization completed. Full final acceptance is **not met**; the live UI/API/provider/media workflows and several required foundations could not be verified.

## What changed

- Hardened `services/process_lifecycle_manager.js`: persisted manifest PIDs are no longer sufficient to terminate a process; registration requires a real child handle; graceful/forced termination uses the owned child reference; exit handling no longer deletes the persisted manifest. This avoids killing a reused or unrelated PID based only on stale JSON.
- Added `scripts/tests/process_lifecycle_stage7.test.cjs` covering manifest-only PID denial and owned-child cancellation.
- Updated `app/frontend/src/components/HarnessManager.jsx` so streamed engine events populate the run timeline, lifecycle status reflects approval/completion/failure/cancellation events, failures are shown as failures, progress is announced accessibly, and approval cards reveal the requested arguments before a one-time approval.
- Updated two stale assertions in `scripts/tests/issue-regressions.test.cjs` to verify actual PDF attachment handling and the true Windows launcher (`Abyx.bat`, called by `windows.bat`).
- Corrected the root README's claims about production readiness, guaranteed privacy/offline use, sandboxing, LAN exposure and data-leak prevention. It now describes local/cloud and execution boundaries plainly.
- Added the final architecture, feature matrix, security report, benchmark record and known-limitations documents. Updated the implementation README links/status.

## Current application state verified from source

- Abyx retains its multi-studio React/Vite design and includes chat, local/cloud models, media, transcription, TTS, projects, study, memory, automations, Harness, skills, MCP and extension management surfaces.
- The frontend builds. The source has a Tool Registry/Gateway for the active Harness route and a bounded read-only Git adapter.
- This is not one canonical runtime across all product workflows. Local text chat, Harness, media workers and persisted run/session state still have separate orchestration paths. Stage 2/3/4 reports remain absent; durable event recovery and a complete provider gateway are not established.
- Security controls exist, but terminal/MCP processes run as the current user and are not OS-isolated. No complete parity or autonomous-safety claim is made.

## Runtime and UI validation

- Attempted to start `scripts/server/serve.cjs` with a unique temporary data/workspace location. It failed to bind `127.0.0.1:1420` with `EADDRINUSE`; startup also logged a temporary database backup validation error while loading multiple services. The user's database was not selected by the test environment.
- A direct loopback HTTP probe was denied by the execution environment's socket policy. Computer Use stopped because it could not confidently determine the open Chrome window's URL. Therefore no live click-through, keyboard, accessibility, responsive, approval, cancellation, settings, model, or media workflow is claimed as verified.
- After the Harness UI update, a Vite preview on `127.0.0.1:5179` started successfully and the production build passed. The in-app browser could not reach that loopback server (`ERR_CONNECTION_TIMED_OUT`), so UI appearance and interactions still could not be visually verified. The temporary Vite server was stopped.
- Source inspection found the Harness passed a single event argument to a callback whose API actually supplies `(eventType, eventData)`. That mismatch meant the existing screen silently ignored the named stream events. The callback now uses the actual contract, retains non-token events for the timeline, and updates status/error/progress from them. The UI build verifies compilation, but no live run or approval click-through was possible here.
- Frontend production build: **passed**, emitted to a unique temp directory. Vite emitted a large-chunk advisory (main JS about 941 kB, PDF worker about 1.38 MB). Existing dirty `app/dist` outputs were not built over.

## Tests

- `node --test` over Stage 1 security, Stage 5 extensibility, Stage 6 capability, Stage 7 process ownership, issue regressions and model-kind suites: **70 passed, 0 failed**.
- Workspace containment, AI usage and dashboard analytics suites: **10 passed, 0 failed**.
- Stage 11 phase 4 feature/API suite using temporary DB/workspace/Obsidian paths: **17 passed, 0 failed**.
- Total passing tests: **97**.
- Provider adapter suite: could not complete. Its mocked local HTTP connections were denied with `EACCES`; four connection/capability assertions failed before the remaining suite ran. This is an environment failure, not a successful provider verification.
- Stage 12 harness suite was not run because it performs real public web search in addition to temporary PDF and harness checks. The legacy `test/agent_harness_test.js` was not run because it recursively deletes the existing shared `test/temp_workspace` and assumes removed APIs.
- Syntax checks and the full provider/media/session recovery suites were not all run. No production data migration was attempted.

## Security regression result

The Stage 1 and Stage 5 adversarial suites passed in the 70-test run. Stage 7 added an additional stale-PID ownership test. The test proves persisted PIDs are not termination authority; it does not prove OS-level descendant containment, which remains unavailable.

One validation side effect requires disclosure: the failed server probe exited through the old process-manager handler, which removed the pre-existing untracked `app/config/abyx-processes.json`. I recreated it from its pre-run contents. At later inspection it contained a newer live LLM record (PID/model differed from the captured version); I left that newer file untouched and did not terminate a process. See `KNOWN_LIMITATIONS.md` and verify the current record against the active model if needed.

## Observability

Run IDs, tool-call IDs, scrubbed JSON execution logs and usage analytics exist. There is no single structured schema spanning every provider/session/worker, no validated retention/export policy, and no complete dashboard for provider latency, job cancellation, process resources or task completion.

## Competitor-inspired assessment

The Stage 0 comparison is a source/documentation review of OpenCode, Pi and DeepSeek Harness, not a runtime benchmark. Abyx's distinction is its local model/media studio breadth. The shared permission/session/runtime depth that would make that breadth reliable remains incomplete. No competitor performance comparison or parity claim is made.

## Benchmark result

No product performance benchmark was completed. One Vite build reported 1.85 seconds; a single build sample is not a startup, API, model, tool or UI benchmark. Hardware and model conditions were not captured. Median/p95 are not reported.

## Acceptance status

| Acceptance area | Result |
|---|---|
| Starts reliably in this environment | Not verified; port 1420 was already occupied and socket access was restricted. |
| Preserve user data/build artifacts | Existing `app/dist` was preserved; process-manifest incident disclosed above. No live DB migration was attempted. |
| One canonical agent runtime | Not met. |
| One authorization gateway for every product tool path | Partial; Harness registry/gateway verified, but all product runtime paths are not consolidated. |
| Meaningful security boundaries | Partial; host execution remains non-isolated and same-user local API auth is absent. |
| Unified local/cloud providers | Not met to Stage 4 contract; provider suite blocked by `EACCES`. |
| Durable sessions and recovery | Not met to Stage 4 contract. |
| Cancellation and recovery | Partial; child/tool cancellation tests pass, but end-to-end durable recovery and process-tree containment are absent. |
| Coding/general workflows | Partial; read-only discovery/Git and reviewed file edits exist; no isolated tests, Git writes, durable jobs or subagents. |
| AI Studio functionality | Source/build present; actual model/media workers not exercised. |
| Inspectable execution history | Partial; scrubbed JSON run logs exist but are not a canonical durable event store. |
| Relevant tests | 97 passed; provider suite blocked; Stage 12 and destructive legacy suite not run. |

## Final status

Stage 7 documentation and bounded stabilization changes are complete. Abyx is **not declared fully accepted or production-ready**. The feature matrix and known-limitations report are the authoritative summary of implemented, partial, deferred and unverified behavior.
