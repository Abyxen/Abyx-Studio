# Decisions and Tradeoffs

1. **One runtime vs several specialized loops:** recommend one state machine and ToolGateway. Cost: migration and temporary adapter work. Benefit: one permission/cancellation/history contract; specialization remains in loop strategies, not bypass paths.
2. **OS sandbox vs command blocklist:** recommend OS isolation for arbitrary commands. Cost: platform-specific packaging and performance overhead. Benefit: security does not depend on parsing every shell grammar. Blocklists remain defense-in-depth only.
3. **SQLite event store vs JSON logs:** recommend SQLite or another transactional append store with snapshots. JSON is transparent and useful for export, but whole-file rewrite per event is expensive and vulnerable to concurrent writes. Keep JSON export as a format, not authoritative concurrent state.
4. **Plugin flexibility vs in-process extension convenience:** use explicit capability permissions and separate host for untrusted extensions. In-process trusted plugins are simpler and faster but share process secrets, filesystem and crash domain.
5. **Model-agnostic abstraction vs provider-native features:** define capability negotiation and preserve native features behind explicit extensions. A lowest-common-denominator API can erase tool/vision/thinking support; provider-specific code everywhere couples the runtime.
6. **Heuristic context vs exact tokenizer:** show estimated telemetry when tokenizer unavailable, label confidence, and prefer provider counts. Exact per-model tokenization adds dependency and version complexity; heuristic silent certainty risks overflow.
7. **Broad AI Studio vs focused coding product:** preserve image/audio/video/local model breadth as optional capabilities, while keeping a focused coding path. The studio's differentiation is breadth; cross-cutting runtime/security should be shared.
8. **Adopt competitor architecture selectively:** OpenCode's integrated workflow, Pi's small embeddable core, and DSH's composition layers solve different needs. Avoid reproducing full UI or plugin complexity just to match feature lists.

These are recommendations based on inspected paths, not decisions already approved or implemented. See 16 and 17 for proposed structure/order.
