# Feature Backlog

| ID | Priority | Recommendation | Complexity | Dependencies |
|---|---|---|---|---|
| G-01 | P0 | Exact shell command authorization; deny shell-composed allowlist bypass | HIGH | policy redesign |
| G-02 | P0 | Symlink-safe path operations and race-resistant writes | HIGH | filesystem boundary |
| G-03 | P0 | OS-level process/code sandbox; accurate trust labels | VERY HIGH | platform security |
| G-04 | P1 | One tool execution/approval gateway across both loops | HIGH | runtime contract |
| G-05 | P1 | Fix unreachable direct command routes | LOW | route test |
| G-06 | P1 | Correct request disconnect, cancellation and browser timeout propagation | MEDIUM | API lifecycle |
| G-07 | P1 | Tokenizer-aware budget and tool-safe compaction | MEDIUM | provider capabilities |
| G-08 | P1 | Unified crash-safe session/run event store and resume | HIGH | runtime state |
| G-09 | P1 | Provider/model capability and stream contract | HIGH | adapter tests |
| G-10 | P1 | Extension trust, provenance, capability API and isolation | HIGH | security model |
| G-11 | P1 | MCP namespacing, per-tool policy, timeout/reconnect audit | HIGH | ToolRegistry |
| G-12 | P2 | Safe structured Git/status/diff/patch workflow | HIGH | sandbox, diff UX |
| G-13 | P2 | Correlated logs, redaction, retention and diagnostics | MEDIUM | event schema |
| G-14 | P2 | Accessible run/approval/diff workflow and visual validation | MEDIUM | stable runtime API |
| G-15 | P2 | RAG quality, provenance, stale-index and injection evaluation | HIGH | corpus/eval harness |
| G-16 | P2 | Unified job/process lifecycle for automation/media/subagents | MEDIUM | job manager |
| B-17 | P3 | Context-aware project index and retrieval ranking | HIGH | G-15 |
| B-18 | P3 | Isolated subagent workspaces and task ownership | VERY HIGH | G-03, G-08 |
| B-19 | P3 | Plugin bundle/profile composition with version/rollback | HIGH | G-10, G-11 |
| B-20 | P3 | Headless/RPC/remote client contract | HIGH | auth, API schema |
| B-21 | P3 | Evaluation dashboard for tool success, latency and resource cost | MEDIUM | G-13, 18 |
| B-22 | P4 | Extension marketplace/discovery and community package sharing | HIGH | trust/signing |
| B-23 | P4 | Advanced parallel orchestration and agent teams | VERY HIGH | G-03, G-04, G-08 |
| B-24 | P4 | Optional ACP-compatible client protocol | HIGH | canonical sessions |
| B-25 | P4 | Fine-grained keyboard customization and theme refinements | LOW | G-14 |
| B-26 | P4 | Remote collaboration/cloud workspace support | VERY HIGH | auth, isolation, privacy |
| B-27 | P4 | Model routing policy by modality/task/budget | HIGH | G-09, usage accuracy |

P0/P1 items are prerequisites for autonomous reliability. P3/P4 items are deliberately deferred until the security and durable-runtime base is established.
