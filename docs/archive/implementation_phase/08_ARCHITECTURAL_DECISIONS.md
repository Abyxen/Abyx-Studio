# Architectural Decisions for Review

These are proposed decisions for future authorization; none has been implemented or approved.

| Decision | Recommendation | Alternatives/tradeoff |
|---|---|---|
| Runtime count | One canonical agent loop and event contract; retain provider-specific adapters. | Multiple loops are quick to evolve but duplicate policy, persistence and cancellation. |
| Tool permissions | Default deny unknown; authorize exact tool/resource/arguments; approval record bound to immutable call hash. | Regex blocklists are easy but miss shell grammar; broad session wildcard is convenient but overpowered. |
| Process boundary | OS isolation for autonomous shell/code. | Node `vm`, cwd pinning and env scrubbing reduce convenience exposure but do not enforce OS capabilities. Requires packaging work. |
| Process ownership | Store app nonce + PID + creation time + executable/owner; never kill unverifiable stale PID. | PID-only manifest is small but unsafe under reuse/restart. |
| Filesystem changes | Stage diff, validate paths at use, preserve backups, report if backup fails. | Direct write is simpler; atomic rename is platform-dependent and does not prevent path races by itself. |
| Sessions | Transactional event store + snapshots; export JSON for portability. | Whole-file JSON is human-readable but synchronous rewrite and concurrent mutation scale poorly. |
| Context | Provider token count when available; label heuristic estimates; compact typed events/tool pairs. | Exact tokenizer for every model costs dependencies; character estimate must not be labeled exact. |
| Providers | Capability descriptor + normalized stream/errors; retain provider-native options behind explicit interfaces. | Lowest-common-denominator contract hides capabilities; per-provider runtime code multiplies complexity. |
| MCP | Real client connection, stable server-qualified tool IDs and per-tool policy; otherwise disable remote tools. | Schema-only display is misleading and produces execution errors. |
| Extensions | Trusted in-process plugins only with explicit trust statement; isolate untrusted packages. | `require()` is fast but shares server secrets, filesystem and crash domain. |
| RAG | Keep current SQLite/FTS/vector implementation pending retrieval eval. | New vector DB/embedding stack is unjustified until recall/scale measurements show current design fails. |
| UI/product scope | Keep Abyx brand and modality studios; unify backend contracts, not screens wholesale. | Copying a coding-agent terminal UI would discard existing studio differentiation. |
| Test execution | Safe unique fixtures, deterministic mocks first; destructive/real-resource test opt-in. | Existing broad tests are useful but current test fixture cleanup overlaps user data. |

Stage order is intentionally security → canonical runtime → durable providers/context → tools/MCP → coding workflow → jobs/studio → UI/benchmarks. The rationale and file ownership are in 05 and 06.
