# Abyx Implementation Status

The baseline, audit validation, security findings, roadmap, file plan, testing strategy, and architecture decisions are recorded in this directory. Stage 1 security work is documented in [STAGE_1_SECURITY_REPORT.md](STAGE_1_SECURITY_REPORT.md), Stage 5 extensibility work in [STAGE_5_EXTENSIBILITY_REPORT.md](STAGE_5_EXTENSIBILITY_REPORT.md), Stage 6 agent capabilities in [STAGE_6_AGENT_CAPABILITIES_REPORT.md](STAGE_6_AGENT_CAPABILITIES_REPORT.md), and Stage 7 validation in [STAGE_7_FINAL_VALIDATION_REPORT.md](STAGE_7_FINAL_VALIDATION_REPORT.md).

## Current verified status

- Stage 1 security controls and adversarial checks are recorded in the Stage 1 report.
- Stage 5 adds a central tool registry and gateway, profile-scoped capability bundles, MCP stdio integration, inert skill package lifecycle, and fail-closed executable extensions.
- Executable extension code is not loaded into the Abyx process. No OS-isolated extension host is configured.
- MCP stdio servers require explicit connection approval and run as the current Windows user. They are separate processes, not isolated processes.
- Skill files are instructions only. They receive no host permissions; project skills override profile and built-in entries.
- The local API binds to loopback and checks Host and Origin. It does not authenticate other processes running as the same user.
- Stage 2/3/4 runtime consolidation, durable run persistence, and unified provider gateway reports are not present. Stage 5 does not claim those deliverables.
- Stage 6 adds bounded repository inspection/search, read-only Git inspection, approval-bound filesystem change previews with content-hash conflict checks, conservative context compaction, and improved RAG stale-source/citation handling. See the Stage 6 report for unsupported cases and prerequisite gaps.
- Stage 7 tightened process termination ownership, corrected stale test assertions, made the Harness run timeline and lifecycle status reflect streamed events, and exposed exact requested tool arguments in approval cards. It added final architecture, feature, security, benchmark and limitations documents. The frontend build passes; live UI/runtime checks remain incomplete and provider tests were blocked. Abyx is not marked production-ready. See the [acceptance matrix](FINAL_FEATURE_MATRIX.md) and [known limitations](KNOWN_LIMITATIONS.md).
- Existing user edits and build artifacts must be preserved. The Stage 5 frontend build was emitted to a temporary directory rather than `app/dist`.

## Next step

Stage 7 stabilization is complete to the bounded scope and limitations recorded in its reports. Full acceptance is not met. No further stage is defined; wait for explicit user direction.
