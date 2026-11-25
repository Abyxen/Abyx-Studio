# Abyx Final Architecture Snapshot

**Evidence date:** 2026-11-25. This describes the inspected source tree; runtime behavior is marked separately in the validation report.

## Product surfaces

- React/Vite frontend in `app/frontend` with chat, model settings, image/video, speech, voice, browser, projects, study, memory, automation, usage and Harness screens. `App.jsx` maps the primary views to URL hash routes.
- Node HTTP server in `scripts/server/serve.cjs` serves `app/dist`, routes local API requests and starts optional model/media workers on demand.
- SQLite stores profile, chat, knowledge and usage records. Run execution logs and some sessions/configuration still use separate JSON files.

## Agent and capability execution

- `agent/execution_loop.js` is the active Harness run loop. Its tools are defined in `agent/tool_registry.js` and invoked through `agent/tool_gateway.js` for schema, permission, approval, timeout, cancellation, output and audit checks.
- The ordinary text-chat path in `TextChat.jsx` still has its own local model conversation and media-directive behavior. The prior reports for Stages 2–4 are absent, and source confirms there is not one canonical lifecycle runtime covering all chat, Harness, media and background workflows.
- Legacy harness consumer/provider execution is disabled or fail-closed. MCP stdio calls enter the registry/gateway; MCP processes use the logged-in account and are not OS-isolated. Executable extensions fail closed.
- Filesystem operations use `PathGuard`; agent `fs_write`/`fs_edit` require reviewed content hashes and a per-call approval. The Stage 6 repository/Git tools are bounded and read-only.

## Providers, sessions and context

- Provider-specific adapters and model discovery remain available, but the Stage 4 unified provider contract is not complete. Fallback visibility and all-provider lifecycle behavior are not claimed.
- Chat history, profile data, usage events and agent-run JSON logs are separate stores. There is no canonical append-only run event store or safe restart/replay protocol. Destructive tool calls must not be automatically replayed.
- Context estimation distinguishes reported token usage from estimates; compaction preserves system instructions, active task/artifacts and complete recent conversation groups. It is not a replacement for durable run state.

## AI Studio process lifecycle

- Optional local model/media workers remain separate processes started by the server. `ProcessLifecycleManager` records child metadata and only terminates a process registered with a live `ChildProcess` handle. A PID from the persisted manifest is not ownership proof and is never sufficient authority to kill.
- Shutdown can request termination of the owned child. There is no Windows Job Object/AppContainer, CPU/memory quota, network isolation, or general descendant-process guarantee. A full process tree may outlive the direct child.

## Security boundaries

- The HTTP server binds to loopback and checks request Host/Origin context. It does not authenticate another local process running as the same user.
- Terminal commands use the structured policy and approval flow, but approved commands run with the user's host permissions. Node `vm` is not a security sandbox; arbitrary untrusted provider code is disabled.
- Filesystem checks and same-directory temporary replacement reduce traversal and race risk. They cannot eliminate every race against a concurrent same-user process.
- Local-only modes keep inference on device after models are installed. Cloud, online search, model downloads and updates transmit requests to selected services.
