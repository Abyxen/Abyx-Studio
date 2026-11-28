# Tools, Skills, MCP and Extensions

## Abyx inventory

`agent/tools/` contains filesystem, terminal and browser tools. The engine dispatches aliases by `if/else` in `executeToolInternal`; `PolicyEngine` separately classifies names. `harness/plugins/consumer_tools.js` builds OpenAI/Ollama schemas and dispatches to providers, `local_tools`, research skills and MCP. The same concept is represented twice, with schema lists and dispatch tables maintained separately. Extension packages under `extensions/` handle manifests, installation, runtime and management. `services/abyx_skills.js` and `research_skills.js` expose skill consultation and research tools. `services/mcp_client.js` stores per-profile MCP settings and routes tools; phase 4 routes add/toggle/remove servers.

## Status and gaps

Tool schemas are present, but there is no single registration record combining unique name, schema validation, required capability, risk, timeout, cancellation, result schema, provenance and lifecycle events. Policy defaults unknown tools to approval in one engine, but the alternate loop bypasses that engine. `run_code` uses Node VM/Python subprocess; neither means OS isolation. MCP is available but its connection lifecycle, resource handling, tool-level authorization and failure recovery need explicit proof. Skill catalog entries are not equivalent to dynamically loaded, context-selected skill bundles. Extension runner executes loaded CommonJS in the server process; treat extensions as trusted installed programs.

## Recommended contract

Define a ToolRegistry with declarative `id`, version, JSON Schema/input validator, description, permissions, timeout, side-effect class, origin and executor. Validate both model arguments and tool outputs. A central ToolGateway should check user policy, workspace capability and session approval; create a typed audit event; pass AbortSignal; enforce output limits; and normalize errors. MCP names should be server-qualified and stable. Skill loading should expose concise descriptions first and instructions only on selection, with source/version and trust. Extension unload must dispose registrations and child processes. OpenCode's tool policies and Pi's `registerTool` hooks are useful references; DSH's provider/consumer split is useful only when its lifecycle and policy guarantees are also copied. No source modification was made.
