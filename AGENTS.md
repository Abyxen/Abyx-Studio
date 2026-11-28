# AGENTS.md — ABYX Autonomous Agent Instructions & Operational Rules

Welcome to **ABYX Unified AI Studio**. This document serves as the primary operational instruction manual and rulebook for all AI agents executing within this repository.

---

## 1. General Security & Operational Permissions (Diagram [1], [1.4])

1. **Approved Workspace Boundaries:**
   - All file writes and modifications must resolve strictly within the active task workspace.
   - Any path traversal (`../`) attempting to access root system folders (e.g. `C:\Windows`, `C:\Program Files`) is strictly blocked by `PathGuard`.
2. **Policy Modes (Diagram [3] - Planning vs. Execution):**
   - **Plan Mode (`plan`):** Only read-only and inspection tools are allowed (`read_file`, `search_files`, `search_content`, `list_directory`, `diagnostics`, `symbols`, `playwright_browser` in read mode). All destructive writes (`write_file`, `smart_file_editor`, `terminal`) are DENIED.
   - **Build Mode (`build`):** Full tool execution is permitted within sandbox boundaries.
3. **Approval Gates (HITL):**
   - Commands flagged as potentially destructive or modifying system-level settings require explicit human approval via the `/api/agent/approve` contract before execution.

---

## 2. Source of Truth & Project References (Diagram [2], [2.1])

When reasoning about system architecture, consult these canonical reference files:
- 🏛️ **Architecture Reference:** `docs/architecture/UNIFIED_ARCHITECTURE.md`
- 🗺️ **Service Map & Network Ports:** `docs/architecture/UNIFIED_SERVICE_MAP.md`
- 🛠️ **Tool Registry & Schemas:** `docs/architecture/UNIFIED_TOOL_REGISTRY.md`
- ⚡ **Agent Runtime Specification:** `docs/architecture/AGENT_RUNTIME_SPECIFICATION.md`
- 📁 **Documentation Index:** `docs/README.md`

### Memory & Persistent State (Diagram [2.1])
- **Two-Tier Memory:**
  - *Ephemeral Working Memory:* Recent message turns dynamically compacted to protect the 32k context limit.
  - *Persistent Immutable Transcript:* Full append-only JSON turn records in `app/data/sessions/` and SQLite memory store in `data/abyx_memory.db`.

---

## 3. Subagents & Multi-Agent Swarms (Diagram [4], [4.1])

When tasks require parallel execution or specialized skill sets, spawn subagents via `SubagentOrchestrator` / `TaskScheduler`:
- **Planner:** Generates and updates DAG execution plans.
- **Developer / Coder:** Implements code files and tests.
- **Reviewer:** Audits code changes for security, style, and unintended side effects.
- **Tester:** Executes tests, collects failure traces, and asserts acceptance criteria.
- **Researcher:** Queries web sources and synthesizes findings with formal citations.

### Worktrees & Workspace Isolation (Diagram [4.1])
- Subagents execute inside isolated task workspaces (`.abyx/workspaces/` or Git worktrees) preventing dirty read/write collisions across parallel threads.
- Checkpoints allow state rollback if an agent encounters unrecoverable errors.

---

## 4. Skills & Verification (Diagram [5], [5.1], [5.3])

1. **Skills Catalog (`skills/`):**
   - Standard `SKILL.md` format (YAML metadata + procedural markdown).
   - Injected dynamically into system context via `ContextManager` based on semantic query match.
2. **Deterministic Verification (Skill Evals):**
   - NEVER report a task as completed without concrete, independent evidence.
   - Use `VerificationEngine` to verify file existence on disk, validate syntax, and run tests.
   - If tests fail, extract line numbers and error traces for autonomous self-correction.

---

## 5. Built-in Autonomous Commands (Diagram [5.2])

- `/init` — Re-scaffolds workspace instructions and baseline verification.
- `/goal <description>` — Bounded autonomous iterative loop executing until all acceptance criteria are verified.
- `/loop <task> [criteria]` — Iterative execution loop with automated evaluation.
- `/batch <tasks...>` — Concurrent task dispatch across specialist subagent swarms.
