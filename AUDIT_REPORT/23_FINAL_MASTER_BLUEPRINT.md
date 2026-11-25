# Final Master Blueprint: Evolving Abyx into a Unified AI Harness

## Objective

Build on Abyx's distinctive local-first model and media studio while making coding and general agent work safe, inspectable, recoverable and extensible. A parity checklist is the wrong target: OpenCode is an integrated coding product, Pi a minimal toolkit, and DeepSeek Harness a plugin-composed runtime. Abyx can combine the relevant strengths without abandoning its studio identity.

## Stage 1: establish trustworthy boundaries

Block shell-prefix policy bypasses and treat arbitrary shell/Python/extension execution as host-level code until OS isolation exists. Implement race-resistant path resolution, centralized per-tool authorization and approval bound to the exact arguments. Tighten local HTTP Origin/Host protections and authentication before public binding. Correct cancellation and process cleanup. Acceptance requires adversarial security tests and one auditable decision for every execution path.

## Stage 2: create one execution contract

Consolidate `AgentExecutionEngine` and `HarnessAgentLoop` behind one run state machine and ToolGateway. Normalize run, step, tool call, provider stream and terminal event schemas. Make local/cloud providers adapters, not separate agent loops. Fix route shortcuts and validate model output structurally. Preserve multiple tool calls and stream events without leaking credentials or untrusted raw payloads.

## Stage 3: durable sessions and context

Use one versioned event/session store, with snapshots and recovery. Persist profile/workspace/session ownership. Use model/provider token limits and exact usage where available; label estimates. Compact typed conversation history while retaining policy, active goal, tool call/result pairs, artifacts and citation provenance. Link project memory and RAG index lifecycle to explicit source metadata and deletion.

## Stage 4: extensibility and coding workflow

Register built-in, MCP and extension tools through the same schema, permission, timeout, cancellation and output-bound contract. Treat extensions as trusted or isolate them in a process. Add Git status/diff and patch workflows only after preserving dirty user state is tested. Build project indexing and test selection on measured repository workloads. Subagents require isolated ownership, context and cancellation before parallel execution.

## Stage 5: product integration and quality

Keep current navigation and brand. Improve chat/run timeline, approvals, diff review, model/fallback disclosure, context confidence and accessibility. Make the common process manager own local LLM/media workers. Add benchmark scenarios for agent quality, security, persistence, UI latency and resource usage; report median/p95 and exact configurations. Set regressions as release gates.

## Target structure and boundaries

Use the architecture in 16: React Studio → authenticated local API → Job/Session Service → single Runtime → Context/Provider/Tool Registry → Permission Engine/Tool Gateway → filesystem, isolated process runner, MCP and extension host. Store events transactionally and correlate logs. Each service owns one lifecycle and has explicit failure behavior. Native media providers remain optional capabilities outside the core agent loop.

## P0/P1 decisions

Do first: G-01–G-04 and G-06, then G-08/G-09/G-11. G-05 is a small correctness fix but should be tested with route integration. Do not build advanced agent teams, marketplace or remote collaboration before process isolation, canonical permissions and durable ownership. See 17 for stages and acceptance criteria; 20 for all 27 tracked items; 18 for validation.

## Audit completion boundary

The requested 25 deliverable files are present. Static architecture and representative source paths, feature statuses, concrete gaps, comparison, roadmap, UI audit, security analysis and benchmark plan are documented. Full execution/testing, complete line-by-line reading of every listed file, visual UI testing, precise live competitor SHAs and performance measurements remain unverified. The audit made no source-code changes, ran no tests and deleted no user data. `AUDIT_METADATA.json` preserves these limits.
