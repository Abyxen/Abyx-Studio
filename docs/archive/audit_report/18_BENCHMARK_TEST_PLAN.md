# Benchmark and Validation Plan

No scenarios below were executed; all are future validation work. Run against pinned Abyx/competitor commits and identical model/provider/tool permissions. Capture actual output and costs; do not compare model quality as if it were harness quality.

| Scenario | Procedure / success | Failure conditions and metrics |
|---|---|---|
| Simple chat | One prompt, streaming | Missing/duplicated tokens; first-token and total latency, usage. |
| Complex reasoning | Multi-constraint task, fixed model | Missed constraints; completion score, tokens, latency. |
| Multi-step action | Create then inspect artifact | Wrong state, false completion; steps, tool errors, approvals. |
| File creation/edit | New and existing fixture files | Unexpected overwrite, incorrect diff; exact diff, recovery. |
| Multi-file task | Related changes across files | Partial/inconsistent edits; changed-file correctness and rollback. |
| Repository exploration | Ask for symbols/config/tests | Unsupported claims; retrieved-file precision, time. |
| Terminal | Read-only and approved write commands | Escaped cwd or unapproved effect; policy decision, process cleanup. |
| Tool selection | Give tasks aligned/misaligned with tool | Invalid schema or wrong dispatch; selection accuracy. |
| Tool failure | Force tool timeout/nonzero exit | Lost state or false success; recovery and event order. |
| Long context/overflow | Scripted growing conversation incl. tool calls | Lost active constraints/tool pairs; tokens, summary fidelity. |
| Session restoration | Kill/restart between events | Duplicated/missing actions; recovery time and event integrity. |
| Model/provider switch | Switch local/cloud during session | Incompatible history or hidden fallback; route, usage, latency. |
| Provider failure | Timeout/429/invalid response | Retry storm or duplicate side effects; retry count/backoff. |
| Skills/MCP | Select skill, call namespaced test server tool | Hidden/unauthorized tool; discovery, authorization, latency. |
| Permissions | Deny/approve/timeout and adversarial shell/path corpus | Any unauthorized effect; decision accuracy and audit evidence. |
| Parallel tasks | Two runs in distinct workspaces | Cross-run data or cancellation; isolation, CPU/RAM/VRAM. |
| Large project | 10k/100k-file synthetic repo | UI freeze/context blowup; scan/index time, memory, retrieval. |
| UI responsiveness | Open chat, stream, approve, cancel, diff | Focus loss/stale state; interaction latency, keyboard completion. |

For each, record baseline, commit SHA, OS, hardware, model/version, provider, context, concurrency, warm-up, repetitions, median/p95, errors and artifact hashes. Separate harness overhead from model/network latency. Competitor tests must run on their own documented configuration and feature flags; source-only findings are not benchmark results. Add security gates for shell separators, encoded traversal, symlink swaps, malicious fetched content, denied MCP tools, extension trust, request disconnect, and hostile Origin.
