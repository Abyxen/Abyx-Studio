# Model and Provider Analysis

## Existing implementation

`providers/registry.js` collects OpenAI, Anthropic, Gemini, Ollama, LM Studio and custom OpenAI-compatible adapters; local runtime management is separate. `services/ai_providers.js` adds model discovery, local/cloud classification, model resolution, streaming, usage and failover. Configuration appears in `app/config/llm-model-settings.json` and `scripts/config/llm-backends.json`; credentials use `security/credential_store.js` and profile settings. Frontend `ModelManager.jsx`, `CloudProviders.jsx` and API wrappers expose model/provider workflows. README claims local engines and optional cloud routing, but this audit does not verify live auth, streaming quality, or endpoint support.

## Gaps

Provider abstractions should expose capabilities beyond `chat/stream`: supported modalities, tool calling, JSON output, context limits, token counting source, cancellation, auth method and retry classification. The main route relies on an `ai_providers` response content field while the alternate harness parses SSE-shaped chunks and local Ollama format itself. This couples runtime behavior to adapter serialization. Failover must distinguish safe-to-retry errors from user-denied actions, avoid duplicate billable tool turns, preserve model-specific message formats, and surface the actual selected provider. Local Ollama/LM Studio endpoints may have different behavior and must be contract-tested, not inferred from OpenAI compatibility.

## Recommendation

Normalize a `ModelDescriptor` and provider request/stream event contract, with explicit provider ID/model ID separation, capability negotiation, credential references (never raw keys in logs), context/output budget, cancellation, idempotent retry rules, and visible fallback trace. Model selection should be per session, with explicit fallback policy. Use actual tokenizer/provider usage when available, mark estimates, and do not claim a context ceiling from model-name substring alone. Evidence: `providers/registry.js`, `providers/*_adapter.js`, `services/ai_providers.js`, `security/credential_store.js`, `app/frontend/src/components/ModelManager.jsx` and `CloudProviders.jsx`.
