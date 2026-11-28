# Architecture Decisions

## ADR-2026-001: Evidence-based completion states

**Status:** Accepted

**Context:** Model prose and placeholder artifacts previously allowed orchestration helpers to report success without a test, artifact check, or other independent evidence.

**Decision:** `success` requires an independent verification result. Model-only task outputs report `requires_verification`; unavailable providers report `blocked`; cancelled and failed operations keep their own states.

**Consequences:** More tasks will visibly require review until they supply verification criteria. The UI and API can now distinguish a useful model answer from a completed engineering change.

## ADR-2026-002: Canonical portable harness files

**Status:** Accepted

**Context:** Agent guidance was spread across application services and large skill collections.

**Decision:** Use root `AGENTS.md`, `INVARIANTS.md`, `.agents/skills/`, and linked documents as the canonical repository harness locations.

**Consequences:** Tool-specific consumers should point to these files instead of duplicating their contents.
