# UI/UX Audit

## Current screens and direction

`App.jsx` routes to Sidebar, TopStatusBar, TextChat, ModelManager, Settings, Generator, transcription, TTS, video, browser and HarnessManager surfaces. Dedicated components exist for projects, terminal, diff, cloud providers, usage, subagents, automations, studybooks, living memory and settings. Existing brand assets/themes and README screenshots establish an Abyx Studio visual direction. Preserve that identity; do not replace the app with a terminal clone.

Static inspection shows a dense multipurpose studio, with feature areas reachable through sidebar navigation and many API functions centralized in `services/api.js`. The harness view exposes run controls, timeline/approvals, plugin and seam status. No screenshots were generated from the running app, and no keyboard, screen reader, responsive, contrast or click-through test was performed. Consequently, this is a source-level interaction inventory, not a verified usability test.

## Competitive patterns to adapt

- OpenCode: compact session-oriented navigation and clear per-tool permission/action states.
- Pi: keyboard-first flow, session branching, visible context/cost state and extensible UI surface.
- DSH: configurable deployment/profile composition and plugin visibility.

## Screen-by-screen plan

| Screen | Keep | Improve/add |
|---|---|---|
| Chat | Existing identity, streaming, workspace access | Run timeline linked to tool cards, cancellation state, model/fallback disclosure, context estimate confidence, approval queue. |
| Harness | Existing run controls and execution timeline | Show one canonical runtime, explicit policy decision, tool output truncation, retry/cancel and diff preview. |
| Models/providers | Catalog and local/cloud controls | Capability/context metadata, connection status, secret-safe configuration, explicit fallback route. |
| Workspace/files | Project controls and preview | Git status/diff, current root and permission scope visible; empty/error/loading states. |
| Automations/subagents | Existing studio panes | Job owner, state, checkpoints, resource budget and durable logs. |
| Media studios | Existing separate workflows | Shared process/worker status and consistent cancel/retry/artifact handling. |
| Settings | Existing themes/settings organization | Group permissions, extensions/MCP trust and data retention; keyboard labels and validation. |

Keep: brand, theme system and modality studios. Improve: chat, model settings, run timeline, diff/terminal. Rebuild only the agent permission and tool trace interaction after backend contract is stable. Consolidate duplicate runtime status and redundant routes. Remove nothing until actual user telemetry/usability research identifies redundant flows. Add a keyboard-accessible approval center and provider/tool capability pages. Refer to 18 for UI responsiveness scenarios.
