# Adobe Repository Harness Mapping

ABYX uses the five control layers from Adobe's *Repository Harnesses for AI Coding Agents: A Practical Guide* as an engineering-time foundation. Adobe's guide explicitly separates this layer from an agent service runtime; ABYX adds the runtime below the repository harness.

| Control layer | ABYX implementation | Current evidence |
|---|---|---|
| Guides | `AGENTS.md`, `INVARIANTS.md`, `.agents/skills/`, architecture documents | Root guidance and task methods are versioned in the repository. |
| Sensors | `npm run validate`, Node test suites, frontend build, verification engine | Validation stops on the first failed required command. |
| Context and state | context manager, session manager, task store, event store, checkpoints | Runtime session and orchestration records are persisted; recovery still requires evidence before any replay. |
| Tool and permission boundaries | Tool Gateway, Policy Engine, Path Guard, Security Engine, sandbox manager | Tool calls are schema and policy gated. Host restricted-process mode is labelled as host execution. |
| Observability and lifecycle | execution logger, normalized events, cancellation, process lifecycle manager | Execution events and terminal outcomes are recorded and cancellation is propagated. |

## Attribution

This mapping is informed by Adobe's Apache-2.0 licensed guide: https://github.com/adobe/ai-repo-harness-guide. It reuses the control-layer concepts and does not copy Adobe source code or prompt templates.
