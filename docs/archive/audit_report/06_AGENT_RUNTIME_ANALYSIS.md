# Agent Runtime Analysis

## Existing paths

`AgentExecutionEngine` (`agent/execution_loop.js`) creates a run, sets a bounded step limit (ceiling 15), emits a timeline, asks an injected `stepExecutor` for the next action, requests approval through `PolicyEngine`, dispatches named tools, and persists via `ExecutionLogger`. The route-level executor is in `scripts/server/harness_routes.cjs`: it sends task plus a clipped recent timeline to `aiProviders.streamProviderChat`, requests strict JSON `{tool,args}`/`{done,result}`, parses the answer, validates tool name and argument object, then calls `executeTool`. This is a bounded single-agent loop rather than a plan-and-delegate planner. Plan structures are initialized but the route does not generate a robust model plan; each step is an action cycle.

The alternate `HarnessAgentLoop` in `harness/agent_seam.js` calls Ollama `/api/chat` with tool schemas, streams deltas, dispatches through `consumer_tools`, and stores session events/turns in JSON. Cloud models take a separate one-shot streaming path. It handles multiple tool calls in one response, unlike the route executor's one JSON action. However, it invokes consumer tools directly without the PolicyEngine approval pipeline and its session store performs synchronous full-file rewrites. The main route does not call it.

## State and lifecycle

Cancellation is represented by AbortController in AgentExecutionEngine. Approval pauses a run and resumes on resolution/timeout. Active runs are memory-only, while completed runs are logged. Tool failures become structured results, but a failed tool is still followed by a model turn; no explicit retry budget or semantic completion verifier is visible. Main route disconnection handling should be corrected and tested. The agent ID/session ID are passed to provider routing, but durable event IDs, recovery after process crash, and resume semantics are incomplete.

## Design recommendation

Choose one canonical runtime and keep provider adapters independent. Runtime should have explicit states (`queued`, `running`, `waiting_approval`, `cancelling`, terminal), immutable correlated events, validated Plan/Step/ToolCall records, one tool gateway, bounded retry/time/token/time budgets, and a resume strategy. Distinguish steering input, follow-up input, cancellation, timeout, denial and provider failure. Multi-agent execution should come after ownership, isolation and cancellation exist. Pi provides an example of a smaller composable loop; OpenCode demonstrates richer session/agent integration; DSH demonstrates replacing loop and tool registry as plugins. Evidence: `agent/types.js`, `agent/execution_loop.js`, `scripts/server/harness_routes.cjs`, `harness/agent_seam.js` and competitor sources in 22.
