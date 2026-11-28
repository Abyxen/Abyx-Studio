# ABYX Unified AI Studio — Documentation Index

Welcome to the documentation for **ABYX Unified AI Studio**, the unified autonomous AI agent environment and engineering platform.

---

## 📁 Documentation Structure

### 1. Architecture & Core Specifications (`docs/architecture/`)
- [UNIFIED_ARCHITECTURE.md](architecture/UNIFIED_ARCHITECTURE.md) — Multi-layer architecture, technology boundaries, concurrency, and zero-VRAM harness invariants.
- [UNIFIED_SERVICE_MAP.md](architecture/UNIFIED_SERVICE_MAP.md) — Service catalog, network ports (1420, 3000, 3001, 10086), API endpoint specifications, and IPC contracts.
- [UNIFIED_TOOL_REGISTRY.md](architecture/UNIFIED_TOOL_REGISTRY.md) — Parameter schemas, execution environments, and capabilities for all 10+ registered agent tools.
- [AGENT_RUNTIME_SPECIFICATION.md](architecture/AGENT_RUNTIME_SPECIFICATION.md) — Bounded execution loop sequence, two-tier context budgeting, output truncation, and verification hooks.

### 2. Verification & Performance Reports (`docs/reports/`)
- [ABYX_TEST_REPORT.md](reports/ABYX_TEST_REPORT.md) — Full test audit report covering all 87 passing test assertions across 13 test suites.
- [ABYX_KNOWN_LIMITATIONS.md](reports/ABYX_KNOWN_LIMITATIONS.md) — Hardware dependencies, GPU inference queuing, and operational recommendations.
- [FINAL_MERGE_REPORT.md](reports/FINAL_MERGE_REPORT.md) — Executive summary of the codebase merger, conflict resolution, and quality certification.

### 3. Codebase Merger & Migration Analysis (`docs/merge/`)
- [MERGE_SOURCE_INVENTORY.md](merge/MERGE_SOURCE_INVENTORY.md) — Complete file and directory inventory of the source codebases.
- [MERGE_FEATURE_COMPARISON.md](merge/MERGE_FEATURE_COMPARISON.md) — Feature-by-feature evaluation comparing OpenHands, OpenCode, and ABYX.
- [MERGE_DEPENDENCY_MAP.md](merge/MERGE_DEPENDENCY_MAP.md) — Consolidated npm and Python dependencies.
- [MERGE_CONFLICT_REPORT.md](merge/MERGE_CONFLICT_REPORT.md) — Identified architectural/naming collisions and their solutions.
- [MERGE_IMPLEMENTATION_PLAN.md](merge/MERGE_IMPLEMENTATION_PLAN.md) — 11-phase execution plan used for the merger.

### 4. Academic & Research (`docs/academic/`)
- `PAP_TGPSI_Abyx_AI_Studio.odt` — Academic project paper and technical thesis documentation.

### 5. Historical Archive (`docs/archive/`)
- `audit/` — Baseline security and compliance audit files.
- `audit_report/` — Historical multi-chapter audit report.
- `implementation_phase/` — Previous implementation phase status reports.
- `pre_merge_docs/` — Archived preliminary notes and earlier drafts.
