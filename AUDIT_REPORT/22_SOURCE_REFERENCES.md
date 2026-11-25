# Source References and Evidence Index

## Abyx local source paths

Project root: `C:\Users\abira\Documents\Local Ai studio Abyx`.

- Bootstrap/server: `Abyx.bat`, `windows.bat`, `linux.sh`, `mac.sh`, `scripts/server/serve.cjs`.
- Frontend: `app/frontend/src/main.jsx`, `App.jsx`, `components/*`, `services/api.js`, `themes.js`.
- Agent: `agent/index.js`, `types.js`, `execution_loop.js`, `execution_logger.js`, `policy_engine.js`, `path_guard.js`, `tools/fs_tool.js`, `tools/terminal_tool.js`, `tools/browser_tool.js`.
- Agent API: `scripts/server/harness_routes.cjs`; core chat/management routes in `scripts/server/serve.cjs`; additional modules in `phase4_routes.cjs` and `cloud_routes.cjs`.
- Harness: `harness/index.js`, `kernel.js`, `seams.js`, `agent_seam.js`, `plugins/*`.
- Providers: `providers/registry.js`, `base_adapter.js`, `openai_adapter.js`, `anthropic_adapter.js`, `gemini_adapter.js`, `ollama_adapter.js`, `lmstudio_adapter.js`, `custom_adapter.js`, `services/ai_providers.js`.
- Tools/extensibility: `services/mcp_client.js`, `services/abyx_skills.js`, `services/research_skills.js`, `extensions/*`, `services/local_tools.js`.
- Context/data: `services/context_manager.js`, `rag/*`, `db.js`, `db_migrations.js`, `data_paths.js`, `services/workspace_service.js`.
- General/Studio: `automations/*`, `services/automation_service.js`, `services/subagents.js`, `services/model_manager_service.js`, `services/process_lifecycle_manager.js`, media service modules and `scripts/workers/*`.
- Existing tests discovered (not run): `test/agent_harness_test.js`, `scripts/tests/*`, `scripts/tests/stage12_harness_capabilities.test.cjs`.

## Competitor primary sources

- OpenCode repo: https://github.com/anomalyco/opencode (branch `dev`); [tools](https://github.com/anomalyco/opencode/blob/dev/services/site/src/docs/content/tools.mdx), [agents](https://github.com/anomalyco/opencode/blob/dev/services/site/src/docs/content/agents.mdx), [MCP](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/mcp-servers.mdx), [ACP](https://github.com/anomalyco/opencode/blob/dev/services/site/src/docs/content/cli/acp.mdx), [tool architecture note](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/tool/AGENTS.md).
- Pi requested repo redirects to canonical https://github.com/earendil-works/pi ; [coding agent README](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md), [extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), [sessions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md), [skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md).
- DeepSeek Harness: https://github.com/deepseek-ai/deepseek-harness ; [architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md), [MCP client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md), [official site](https://www.deepseek.com/harness/en/).

## Revision and limitations

GitHub's reachable commit-history pages showed OpenCode short SHA `95daf90`, Pi `71dca87`, and DeepSeek Harness `c291e79` on September 10–11, 2026. Those pages were crawled two months before this audit and therefore are historical references, not asserted current branch tips. GitHub API SHA lookups were inaccessible via the research interface; exact November 25 SHAs could not be verified. Abyx was read at HEAD listed above plus its dirty working-tree overlay. Source links use mutable branch names where the exact snapshot could not be pinned. Do not attribute claims beyond the linked docs/source or infer runtime success from documentation.
