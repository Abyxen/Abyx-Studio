# Stage 6 — Agent Capabilities Report

**Date:** 2026-11-25  
**Scope:** Repository context, reviewed filesystem edits, read-only Git inspection, context budgeting, and RAG safeguards. This stage does not claim completion of the missing Stage 2/3/4 foundations.

## Findings verified

- The Stage 1 and Stage 5 reports are present and were reviewed. Reports for Stages 2, 3, and 4 are absent. Current code and those reports confirm that a complete unified lifecycle runtime, durable run event store/recovery, and standardized provider gateway are not established.
- Context compaction could drop older messages without explicitly protecting active task state or keeping compaction units together. The context API also did not pass provider usage or active task/artifact state through.
- Workspace writes and edits did not require a content fingerprint from the review step. Overwrite approval did not show the complete proposed diff.
- Repository search/indexing was not a bounded, ignore-aware project inventory. Git did not have a structured read-only adapter.
- RAG citation content was fenced against one closing tag, but citation metadata could still inject markup into the source attribute. Retrieval did not reject an index whose underlying file had changed.
- The legacy memory reviewer applied model-proposed actions automatically if invoked. It now returns proposals that require explicit approval. The existing profile memory UI/API remains the mutation path; project-scoped memory is not implemented.

## Implemented

- Added bounded repository inventory and lexical search with ecosystem/configuration/test discovery. It skips symlinks, common generated/dependency directories, binary content, oversized files, deep trees, and excessive scans. Repository tools use the existing Tool Registry and Tool Gateway.
- Added a structured Git adapter for status, diff, log, and branch inspection. It uses argument arrays with `shell:false`, bounded output and time, and disables external diff/text conversion and fsmonitor. It does not stage or commit.
- Added filesystem content hashes to reads. Agent writes and edits require a hash for existing files, reject stale/missing review hashes, show a bounded proposed diff for approval, and recheck the target immediately before atomic replacement. New-file writes also require approval and reject a file that appeared after review.
- Context telemetry now accepts provider-reported usage and provider context limits, and labels estimates separately. Compaction preserves system instructions, active task/artifact pins and complete recent conversation groups. It returns a blocked result without dropping required content when the target cannot fit.
- RAG retrieval now skips missing or changed source files and returns stale source IDs. Category/tag filters are supported. Citation metadata and excerpts are escaped so document text cannot break out of the passive context wrapper.
- The legacy memory reviewer now proposes actions without writing profile memory or syncing them to another store.

## Security architecture and guarantees

All newly exposed repository and Git inspection tools are registered in the existing central registry and are subject to the existing Tool Gateway. Filesystem writes still pass through `PathGuard`, are approved by policy, and use same-directory exclusive temporary files and hash revalidation. Retrieved document text is treated as untrusted data and escaped before inclusion in citation context.

This stage does not create a new process boundary. As documented in Stage 1, arbitrary provider code is disabled because Node `vm` is not an OS sandbox. Approved terminal commands and MCP processes run under the logged-in Windows account and are not isolated. No test-command execution workflow was added. Git staging/commit, hooks, filters, and automatic test runs are therefore not exposed by the new adapter.

## Unsupported and remaining risks

- Full Stage 3 canonical runtime and Stage 4 durable event/session persistence/provider gateway remain prerequisites. Runs, approvals, and memory proposals are not durably recoverable under the Stage 4 contract.
- Multi-file edit transactions, conflict-aware rollback UI, and an atomic change-set approval/recovery flow are not implemented. Individual file backups are stored beside the file in `.abyx_backup`; manual recovery is required.
- Git staging and approval-bound commits are not implemented. The adapter is read-only and does not reset, clean, or discard changes.
- Automated test discovery is implemented, but autonomous test execution is unsupported until the execution isolation and unified runtime/persistence contracts are complete.
- Project-scoped persistent memory and memory edit/delete management are not implemented. Profile memory remains profile-wide. Model-generated memory is now proposal-only.
- Background jobs, subagents, isolated workspaces, and durable job recovery are not implemented; no subagent execution was added.
- The RAG index uses the existing lexical/hash-vector approach, not a semantic embedding model. Retrieval quality and citation correctness have only focused coverage here; broad corpus evaluation is outstanding.
- Node filesystem path checks cannot eliminate every same-user race against hostile local processes. Existing Stage 1 sensitive-path restrictions remain in force.
- Localhost Host/Origin protections do not authenticate a hostile process running as the same Windows user.

## Files changed in Stage 6

- `agent/git_adapter.js` (new)
- `services/repository_context.js` (new)
- `services/context_manager.js`
- `agent/index.js`, `agent/execution_loop.js`, `agent/policy_engine.js`, `agent/tools/fs_tool.js`
- `rag/knowledge_service.js`
- `services/memory_reviewer.js`
- `scripts/server/harness_routes.cjs`
- `scripts/tests/stage6_agent_capabilities.test.cjs` (new)
- `IMPLEMENTATION/README.md`

## Verification

- Stage 6 focused tests: **5 passed, 0 failed**. Coverage includes context compaction/tool-result grouping and overflow blocking, repository discovery/ignore behavior, dirty Git status without mutation, stale-hash filesystem edit conflicts, and citation prompt-injection escaping.
- Existing Stage 1 and Stage 5 tests: **27 passed, 0 failed**. This includes shell injection, path/symlink checks, filesystem race fixtures, cancellation/process-tree cleanup, gateway authorization, and extension/MCP controls.
- Combined executed test set: **32 passed, 0 failed**.
- `node --check` passed for the changed JavaScript modules checked: agent registry wiring, execution loop, Git adapter, repository context, knowledge service, and context manager.
- The first Stage 6 test run exposed a citation metadata escaping defect and a test fixture that exceeded the protected context budget. The escaping defect was fixed and the fixture corrected; the final run passed. No unresolved test failure remains in the executed set.
- No frontend build, full application suite, corpus-scale RAG evaluation, migration, or autonomous host command test was run.

## Recovery instructions

- Before reverting Stage 6, preserve user changes and generated files. Review `git status` and the exact diff; do not use `reset --hard`, `clean`, or broad checkout commands.
- Individual filesystem edits create a sibling `.abyx_backup` copy. To recover, inspect the backup and target, then restore the desired file manually. The change is not a transaction across multiple files.
- Repository/Git inspection is read-only. No Stage 6 operation changes the Git index or commit history.
- Memory reviewer results are proposals only. Apply them only after user review through the existing memory management flow.

## Stage status

Stage 6 work is complete to the implemented scope and limitations above. Stop here and wait for explicit authorization before beginning Stage 7.
