# Executive Summary

## Scope and confidence

This is a static architecture and capability audit of the current Abyx working tree on 2026-11-25. The committed base is `4e7d59e9851b4da09489ebcafe2a8541bb6e03cf`. At audit start, 14 tracked paths were modified, two tracked generated assets were deleted and replaced by new assets, and several files/services/tests were untracked. Findings therefore describe the checked-out tree, including those pre-existing edits, not only the commit. The visible source inventory contains 183 files when installed dependencies and generated bundle output are excluded. Core runtime paths were inspected; exhaustive line-by-line review of every file and runtime verification were not completed. No tests were run and no application code was changed.

## Assessment

Abyx is a broad local-first AI workstation with substantial product surface: React/Vite UI, a Node HTTP server, SQLite persistence, local and cloud model adapters, image/speech/voice workflows, automation, browser/search, RAG, MCP configuration, skills, extensions and a bounded agent route. It is not yet one coherent harness. Capabilities are split across `agent/execution_loop.js`, `harness/agent_seam.js`, `harness/plugins/consumer_tools.js`, old chat logic in `scripts/server/serve.cjs`, and independent services. The “DeepSeek Harness” naming in `harness/` is Abyx's Cordis-inspired imitation; it does not mean it is DeepSeek's implementation.

## Highest-priority issues

1. **P0 — Shell authorization is bypassable by command composition.** `agent/policy_engine.js` checks safe read-only commands with regexes that accept trailing shell syntax. A command beginning `git status; ...` can be classified safe before dangerous content is evaluated. The terminal invokes a general shell via `exec`; workspace cwd does not confine file or network access. This is a safety boundary failure, not a feature gap.
2. **P0 — Filesystem containment needs a complete boundary review.** `agent/path_guard.js` checks the immediate parent only when it exists. A target below a missing subdirectory whose earlier ancestor is a symlink can pass the create check and later escape when recursive directories are made. Check-then-use filesystem operations also permit symlink races. `PathGuard` is not a process sandbox.
3. **P1 — Agent loop contracts disagree.** The main `/api/agent/stream` route creates `AgentExecutionEngine`; the other exported `HarnessAgentLoop` directly dispatches to consumer tools and has no common policy/approval lifecycle. The latter has local-only Ollama tool-calling and a separate JSON session log. These duplicate paths invite inconsistent behavior and security regressions.
4. **P1 — Several “implemented” features are only partially functional.** The route's direct-command shortcuts test `stepsExecuted === 0` after the engine increments it, so those shortcuts cannot run. Agent run output, memory/context compaction, session ownership and UI status need end-to-end confirmation. A context compactor summarizes only first lines and drops tool calls/most conversation structure; its token count is heuristic.
5. **P1 — Unauthenticated local web surface is broad.** The HTTP server defaults to loopback but returns wildcard CORS and offers highly privileged local actions. Binding to `0.0.0.0` is an explicit option and UI has no login. A local-only default is helpful but not a sufficient boundary against hostile browser origins or shared-network deployment.

## Competitor lessons

OpenCode is a mature, multi-surface TypeScript product with explicit provider/session/tool/permission APIs, built-in tools, MCP, plugins, agent roles, and configurable execution policies. Pi is intentionally a smaller embeddable toolkit: unified model API, agent loop, coding agent, append-oriented sessions with branching/compaction, and runtime extension hooks. DeepSeek Harness is the most direct reference for plugin composition: Cordis contexts, layered profile/bundle composition, plugins as replaceable services/effects, sessions, tools, permissions and multiple UI/CLI deployment forms. These systems are not interchangeable: Pi optimizes composability/minimal core; OpenCode optimizes an integrated coding product; DSH optimizes plugin-composed runtime. Exact feature claims and known limitations are in 01 and 22.

## Recommended order

First make process and filesystem boundaries defensible, enforce one permission pipeline for every agent/tool entry point, and fix route/cancellation/run-state contracts. Next consolidate to one runtime, define typed provider/tool/event/session contracts, and add integration coverage. Then harden provider/model routing and streaming, improve context/session recovery, and make extensions/MCP lifecycle observable and permissioned. After those foundations, expand indexing/RAG, subagents and general workflows; measure performance before optimization. Preserve Abyx's local AI Studio identity and add coding-agent workflows into it rather than copying a competitor's UI.

## Findings count

The companion documents register 16 unique gap IDs (G-01–G-16) and 27 roadmap/backlog recommendations. Priorities and complexity are estimates from static review, not implementation estimates validated by a team. See 05, 17 and 20.
