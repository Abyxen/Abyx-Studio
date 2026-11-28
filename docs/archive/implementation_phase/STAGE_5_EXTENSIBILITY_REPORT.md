# Stage 5 — Unified Tool Registry, Skills, MCP and Extensions

## Outcome

Stage 5 capability management and execution controls were implemented and verified within the existing application. The work does not complete the earlier runtime, durable-session, or provider-gateway stages; those reports were absent and source inspection confirmed those architectures remain unfinished. This report distinguishes the implemented capability controls from those outstanding dependencies.

## Findings verified

- Agent built-ins had been listed and dispatched through separate code paths. A Stage 5 registry/gateway now owns the active agent tool path; the legacy harness dispatcher is fail-closed.
- MCP previously included `calculate_or_eval`, backed by Node `vm` and a Python subprocess fallback. Both executable evaluators are removed from the exposed API. The remaining local MCP tools are read-only and are invoked by registered core tool wrappers.
- MCP server connections were not backed by a live transport. A stdio JSON-RPC transport is now present; HTTP/SSE transports remain unsupported.
- Extension plugins could be `require()`-loaded into the application process. Plugin loading now fails closed. Installed executable plugin and MCP packages stay disabled.
- Skills were discovered from built-in/profile locations without project precedence or declared lifecycle metadata. Project skill discovery now takes precedence and treats files as instruction text, never as host capabilities.
- Tool enablement had no profile persistence. Tool and bundle toggles now store profile-level overrides when the existing database setting API is available.
- The local API uses loopback binding and Host/Origin checks; these checks do not authenticate a local process running as the same user.
- Stage 3/4 reports were not present. Source confirms there is no completed canonical state-machine runtime, durable run event store, or unified provider adapter contract. Stage 5 does not mark those stages complete.

## Implemented architecture

### Registry and Tool Gateway

`agent/tool_registry.js` validates stable IDs, semantic versions, descriptions, risk categories, permissions, provenance, timeouts, output caps, and bounded JSON schemas. Duplicate IDs and unsupported schema keywords are rejected. The registry supports built-in tools, MCP tools, enable/disable, and named capability bundles.

`agent/tool_gateway.js` is the shared execution point for the active agent runtime and routed browser/terminal APIs. It checks registration, schema, enabled state, external capability grants, current policy, exact approval, timeout and cancellation signals, output schema, output size, and audit correlation. Unknown tools fail closed. Results and audit metadata are scrubbed before returning or recording.

Built-in tools include workspace files/documents, terminal, browser/search, skills/memory, machine information, and research tools. Profile-level bundle toggles group workspace files, web research, host terminal, research writing, and skills/memory. Individual tool toggles are also available in the Tools UI.

### Skills

Discovery precedence is built-in, legacy user, profile-installed, then project `.abyx/skills` (later entries override matching IDs). Project and profile skill instruction files are checked against symlink escapes. Skill metadata includes version, origin/scope, declared dependencies, and an empty host-permission list. The package manager supports inspect, explicit approval and content-hash verification for install and update, enable/disable, version backups, and removal. Updates preserve the prior version, re-check package identity/version/permissions, and keep executable types disabled. Dependencies are recorded but are not automatically resolved or installed.

### MCP

The MCP transport launches only explicitly configured stdio commands, with `shell: false`, after the user confirms that the command may run with their account permissions. It uses server-qualified lowercase IDs, validates tool schemas, validates server/tool names and arguments, limits JSON-RPC frames, in-flight requests, timeouts, output size, and stderr capture, supports request cancellation, reports status/errors, and terminates child processes on disconnect or application shutdown. MCP tools are registered into the same Tool Registry and execute through the Tool Gateway. Exact approval is still required for external tool actions.

Secrets may be passed through credential-store references, never persisted as plaintext environment values. Reconnection is a manual user action. Calls are not automatically retried because a retry could repeat a side effect.

### Extensions and UI

Package installation requires an explicit approval flag, reviewed permissions, and a content hash matching the inspected package. Provenance and hash are stored. Package copying uses staging directories and rejects symlinks. Skills may be enabled because they are instruction-only; executable plugins/MCP packages cannot be enabled until an isolated extension host exists. The legacy plugin loader now throws before requiring extension code.

The existing Harness Manager UI exposes tools and bundles, skills, MCP server status and connection controls, and extension inspection/install/update/activation/removal. User confirmations explain the account-level execution boundary for MCP and the disabled state for executable extensions.

## Files changed for Stage 5

- `agent/tool_registry.js` (new), `agent/tool_gateway.js` (new), `agent/index.js`, `agent/execution_loop.js`, `agent/policy_engine.js`
- `services/mcp_client.js`, `services/mcp_stdio_manager.js` (new), `services/abyx_skills.js`
- `extensions/manifest_validator.js`, `extensions/package_manager.js`, `extensions/extension_service.js`, `extensions/plugin_runner.js`
- `scripts/server/harness_routes.cjs`, `scripts/server/phase4_routes.cjs`
- `app/frontend/src/components/HarnessManager.jsx`, `app/frontend/src/services/api.js`
- `scripts/tests/stage5_extensibility.test.cjs` (new)
- `IMPLEMENTATION/README.md`, `IMPLEMENTATION/STAGE_5_EXTENSIBILITY_REPORT.md` (new)

These files remain in a previously dirty worktree; the list describes Stage 5 changes and does not imply other pre-existing modifications were reverted or authored by Stage 5.

## Isolation guarantees and limitations

- **Executable extensions:** fail closed; no plugin code is run. This is the strongest supported guarantee until a platform-isolated extension host is implemented.
- **MCP:** process separation only. MCP commands have the current user’s Windows permissions and inherited workspace access; no Job Object restrictions, restricted token, AppContainer, network namespace/firewall, read-only mounts, or memory/CPU quota are configured. Process separation is not a security sandbox.
- **Terminal:** trusted host execution after policy approval; not OS-isolated.
- **Skills:** instruction text only, no direct tool or filesystem grant. Instructions can influence model behavior, so the normal tool policy still applies.
- **Local API:** loopback and browser-origin checks reduce remote/browser-origin exposure but do not stop another same-user local process from calling the API. No per-client authentication is configured.
- **Runtime/provider boundary:** tool approval/cancellation is shared at the gateway, but the complete Stage 3 lifecycle runtime and Stage 4 persistence/provider gateway remain outstanding.
- **Profile settings:** profile-scoped enabled overrides persist through the available database settings API. Extension/skill package data remains on its existing package-manager storage model; this is not a new canonical event store.
- **MCP lifecycle:** stdio only, manual reconnect, no automatic retries. Cancellation notifies MCP and aborts the request locally; a nonconforming server may ignore cancellation until it exits or is disconnected.
- **Tool bundles:** built-in bundles are configurable. Third-party executable plugin bundles are not runnable, and no marketplace/remote bundle catalog was added.

## Tests executed

- `node --test scripts/tests/stage5_extensibility.test.cjs scripts/tests/stage1_security.test.cjs` — 27 passed, 0 failed. Coverage includes schema/registry rejection, approval and capability gates, output bounds and secret redaction, cancellation, MCP stdio connection/call/timeout/disconnect, skill precedence and symlink rejection, extension install provenance/fail-closed execution, shell injection, filesystem traversal/races, process cleanup, and local API Origin/Host checks.
- `node --check` on 15 changed server, registry, gateway, MCP, skill, and extension JavaScript files — passed.
- Runtime construction smoke check — passed; all 23 built-in tools registered and all 5 named capability bundles were available.
- Vite production build to `C:\Users\abira\AppData\Local\Temp\abyx-stage5-build` — passed. Vite reported a large main-chunk advisory; build output was kept out of `app/dist` and the temporary output was removed.

### Failed tests

No outstanding test failures. One intermediate assertion expected a partially redacted bearer prefix; the implementation redacted the full credential-bearing field, so the assertion was corrected. The final combined run passed all 27 tests. An initial build attempt used the repository root, which has no `package.json`; the build succeeded after running from `app/frontend`.
## Remaining risks and follow-up

1. Implement and verify Stage 2/3 canonical runtime consolidation before claiming that every Abyx agent path shares the same lifecycle and cancellation semantics.
2. Implement and verify Stage 4 durable session/event recovery and provider gateway; current provider adapters are not standardized by this stage.
3. Build a genuine Windows isolation host for executable plugins and MCP (restricted token/AppContainer or disposable container/VM), with CPU, memory, filesystem, and network controls before enabling untrusted code.
4. Add same-user local API authentication if the threat model includes other local processes; Origin validation alone is not process authentication.
5. Add UI management for credential references and individual MCP permissions; current APIs accept per-tool permissions and secret references, while the management UI uses a reviewed server capability grant.
6. Add dependency resolution and install/update dependency lifecycle for skill bundles.
7. Add integration tests with a real stdio MCP fixture and Windows child-process-tree teardown, plus provider/runtime concurrency and persistence coverage when those stages are authorized.

## Recovery instructions

- Preserve the current worktree first. Do not reset/clean the tree; it contains pre-existing changes and generated artifacts.
- To disable a capability immediately, use the Tools tab or its profile override. To stop an MCP process, use Disconnect; removing/disabling its server also removes its registered tools on the next registry refresh.
- Executable extensions are disabled by design. If a previously installed registry entry is inconsistent, disable it rather than invoking its source code; the package backup is under that profile’s extension `backups` directory.
- If Stage 5 must be reverted, restore only the Stage 5-owned files listed above from a known-good revision/backup. Preserve all files and data outside that exact list. Keep extension plugins disabled and remove exposed MCP tool registrations until rollback is complete.

## Stage boundary

Stage 5 is complete to the documented capability-system scope and limitations. No Stage 6 work was started. Stop here and wait for explicit authorization.
