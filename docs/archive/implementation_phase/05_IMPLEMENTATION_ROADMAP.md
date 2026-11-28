# Seven-Prompt Implementation Roadmap

This is a future sequence, not authorization. Each prompt should be executed as a focused change with a reviewed diff. The baseline worktree is dirty; never reset/clean it. Rollback means revert only the authorized stage's own patch and preserve all pre-existing paths/data.

## Prompt 1 — Security boundaries and permission contract (Stage 1)

- **Objective/problems:** close G-01–G-03 and process identity risk G-16; establish one API/tool authorization contract. Prefix regexes authorize composed shell; the direct terminal route runs approval-required commands without approval; session grants are not threaded into active policy and the grant endpoint accepts arbitrary caller-supplied identities/rules; path checks race; VM/Python are not sandboxes; process manifest may kill a reused PID.
- **Files:** `agent/policy_engine.js`, `agent/path_guard.js`, `agent/tools/terminal_tool.js`, `agent/tools/fs_tool.js`, `harness/plugins/provider_sandbox.js`, `services/process_lifecycle_manager.js`, `scripts/server/serve.cjs`, `scripts/server/harness_routes.cjs`, new tests under `scripts/tests/` with isolated temp roots. Keep current dirty changes intact.
- **Decisions/dependencies:** no arbitrary shell in “safe” mode; exact executable policy plus OS sandbox for autonomous shell; user-run local terminal may remain trusted/interactive. Windows Job Objects/AppContainer or documented platform boundary must be chosen before untrusted execution. Never label `vm` isolation secure. Process identity proof is required before termination.
- **Acceptance:** harmless allowlist commands pass; all shell composition, unrecognized commands and ambiguous paths require approval/deny on both agent and direct terminal routes; session grants are owner-bound, narrow, expiring and revocable; symlink/junction and race cases cannot escape; process cleanup never kills unverifiable PID; Origin policy rejects untrusted browser calls.
- **Tests:** unit policy matrix; direct `/api/terminal/execute` approval gate and session grant ownership/expiry/revocation; fs symlink/ADS/traversal/TOCTOU integration; shell metacharacter and timeout/kill-tree security suite; process manager fake-manifest/PID-reuse tests; CORS/Host/CSRF tests; regressions for approved normal file write and terminal UI.
- **Risks/rollback:** platform-specific sandbox and shell semantics; do not ship allowlist fallback as isolation. Roll back only stage patch if safe behavior breaks, leaving dangerous commands disabled until repaired.

## Prompt 2 — Canonical run loop and API events (Stage 2)

- **Objective/problems:** consolidate active `AgentExecutionEngine` and disconnected `HarnessAgentLoop`; fix G-05/G-06; all tool calls must use Prompt 1 gateway.
- **Files:** `agent/execution_loop.js`, `agent/types.js`, `harness/agent_seam.js`, `harness/index.js`, `harness/plugins/consumer_tools.js`, `scripts/server/harness_routes.cjs`, `app/frontend/src/services/api.js`, `HarnessManager.jsx`, `TextChat.jsx`.
- **Decisions:** typed run state machine, schema-validated model actions, consistent tool result events; `res`/socket disconnect lifecycle; separate cancel/deny/timeout/provider failure. Retain old path behind compatibility adapter until parity.
- **Acceptance:** every route uses one runtime and ToolGateway; first-step folder/PDF works; cancellation stops model/tool/provider; unknown tool cannot execute; event order stable.
- **Tests:** unit transitions/step counting/schema; route integration SSE success/error/disconnect; security test proves no direct consumer dispatch; UI regression for approval/cancel/stream end.
- **Risks/rollback:** frontend event-shape break. Keep old event adapter, feature flag only if both paths obey same authorization; revert adapter patch only.

## Prompt 3 — Durable sessions, provider gateway and context (Stage 3)

- **Objective/problems:** G-07–G-09/G-13; histories are split, live runs do not recover, provider formats vary, compaction is heuristic.
- **Files:** `db.js`, `db_migrations.js`, `agent/execution_logger.js`, `harness/agent_seam.js` (retire after migration), `services/context_manager.js`, `providers/base_adapter.js`, `providers/registry.js`, `services/ai_providers.js`, `providers/*_adapter.js`, `scripts/server/*routes`.
- **Decisions:** additive schema/event store; model capability descriptor; explicit token count confidence; no replay of side-effecting tool without idempotency/confirmation.
- **Acceptance:** resume completed/interrupted sessions safely; exactly one tool result recorded per call; provider fallback visible; compacted history retains system policy and complete tool pairs.
- **Tests:** migration from old JSON/SQLite fixtures; crash/replay and concurrent append integration; adapter contract suite using deterministic mocks; token estimate/actual comparison; long-context and model-switch regressions.
- **Risks/rollback:** data migration and double execution. Export old run/session JSON; use additive migration and read compatibility until validation.

## Prompt 4 — Tool registry, real MCP, skills and extensions (Stage 4)

- **Objective/problems:** G-10/G-11 and B-19/B-22; remote MCP tools are schema-only, extension runner is in-process, schemas/policies duplicated.
- **Files:** `harness/plugins/consumer_tools.js`, `services/mcp_client.js`, `scripts/server/phase4_routes.cjs`, `extensions/*`, `services/abyx_skills.js`, new `tools/registry.js`/`tools/gateway.js` interfaces, UI settings components.
- **Decisions:** source-qualified IDs, versioned schemas, auth references, per-tool approvals; MCP transport dependency choice is an explicit future decision; extensions remain disabled unless trusted/isolated; skill instructions do not grant capabilities.
- **Acceptance:** live test MCP stdio/HTTP servers discover and execute through gateway; broken/unavailable server is visible; all plugin tool requests are permission checked; unload removes resources.
- **Tests:** schema validation, duplicate ID, bad server, timeout/reconnect/cancel, injection, secret handling, extension code trust and permission denials; config/skill UI regression.
- **Risks/rollback:** protocol and dependency changes. Keep prior local tools path; disable remote entries instead of claiming partial success; remove only stage-created dependencies if unused.

## Prompt 5 — Coding workflow and repository understanding (Stage 5)

- **Objective/problems:** G-12/B-17; no dedicated Git or structured patch flow, `.git` is blocked, repo search/index is limited.
- **Files:** `agent/tools/fs_tool.js`, `agent/path_guard.js`, `services/workspace_service.js`, `scripts/server/harness_routes.cjs`, `cloud_routes.cjs`, `app/frontend/src/components/DiffViewer.jsx`, `TerminalConsole.jsx`, `HarnessManager.jsx`, tests.
- **Decisions:** first read-only Git status/diff; no auto-commit/reset; staged diff before writes; index ignores secrets/build folders and respects `.gitignore`.
- **Acceptance:** repo exploration points to source; multi-file patches reviewable; user changes preserved; test command executes only in approved isolation; conflicts offer recovery.
- **Tests:** synthetic Git repos with dirty/untracked files, patch exactness/conflict, ignored/secrets files, large repo resource caps; regression for normal workspace operations.
- **Risks/rollback:** accidental modification of user repository. Run only against disposable fixtures; no destructive Git APIs in early stage; rollback stage code and retain any user edits.

## Prompt 6 — General jobs, subagents and AI Studio processes (Stage 6)

- **Objective/problems:** B-18/B-20/B-21/B-23/B-26/B-27 and process lifecycle coverage; personas are not isolated agents, automation lifecycle is separate, media workers have different supervision.
- **Files:** `services/subagents.js`, `automations/*`, `services/automation_service.js`, `services/process_lifecycle_manager.js`, `services/model_manager_service.js`, `scripts/server/serve.cjs`, workers, `services/rag_service.js`.
- **Decisions:** durable job identity/cancel/ownership; child jobs require isolated workspaces; keep media as optional capabilities; remote exposure is out of scope without auth/tenancy review.
- **Acceptance:** scheduled job state durable; cancellation/timeout cleans owned process only; resource budgets and worker health visible; subagents cannot cross workspace boundary.
- **Tests:** timer/process fake clock, restart recovery, per-role process cleanup, concurrency/resource caps, subagent isolation, cloud routing/budget tests; media smoke tests only on configured hardware.
- **Risks/rollback:** model/GPU side effects and stale jobs; use mocks for CI, opt-in local hardware tests, preserve existing model files/data.

## Prompt 7 — UI, accessibility, benchmarks and stabilization (Stage 7)

- **Objective/problems:** G-14/G-15/B-20/B-21/B-24/B-25 plus all acceptance gates; improve visibility without erasing Abyx identity.
- **Files:** `app/frontend/src/App.jsx`, `components/*`, `services/api.js`, `styles/*`, `scripts/tests/*`, new benchmark fixtures/docs.
- **Decisions:** coding/general/studio views share session/runtime; benchmark harness compares measured latency/quality separately; optional ACP only if demand validated.
- **Acceptance:** keyboard/accessibility suite; clear run/approval/diff/model-fallback UI; benchmark results reproducible with pinned model/hardware/provider; no critical security regression.
- **Tests:** browser E2E, screen-reader/keyboard, responsive/visual regression, complete unit/integration/security suites, performance benchmark repeat run, upgrade/rollback checks.
- **Risks/rollback:** wide UI and data compatibility. Roll back UI per component behind stable API; preserve saved sessions and model configuration.

## Sequence gate

Prompt 1 must pass before enabling autonomy. Prompt 2 before adding orchestration. Prompt 3 before resume/memory claims. Prompt 4 before MCP/extensions are advertised. Prompt 5 before coding-agent parity claims. Prompt 6 before parallel/background autonomy. Prompt 7 is stabilization, not a substitute for earlier gates.
