# ABYX Unified AI Studio — Known Limitations & Recommendations

## 1. Hardware & System Dependencies

1. **Local Model Hardware Footprint:**
   - The bundled local model (`AbyxV2 9B.gguf`) occupies ~5.9 GB of VRAM. A dedicated GPU with at least 8 GB VRAM (such as the NVIDIA RTX 4060/5060 Laptop GPU or higher) is required for full offloading (`-ngl 99`).
   - On systems without a dedicated NVIDIA GPU, inference will fallback to CPU or Vulkan backend (`app/llm-backend/win/vulkan/llama-server.exe`), which increases turn latency from ~3-5 seconds to ~15-30 seconds.

2. **Python Document Tool Suite Requirements:**
   - Full binary document generation requires Python 3.10+ with `reportlab`, `python-docx`, `openpyxl`, `python-pptx`, and `Pillow`.
   - The libraries are pre-installed in the user's active Python environment (`Python 3.15.1`). On new client machine installations, running `pip install -r requirements-docs.txt` or bundling an embedded Python runtime is required.

3. **Playwright Browser Binaries:**
   - Headless Chromium browser automation relies on Playwright browser binaries. The Playwright package (`^1.65.1`) is installed in `node_modules`, but requires `npx playwright install chromium` on fresh machines if cached browser binaries are absent.

---

## 2. Operational & Behavioral Constraints

1. **Thinking Model Token Budgeting:**
   - `AbyxV2 9B.gguf` produces reasoning tokens inside `<think>...</think>` tags (or `reasoning_content`). For simple tasks or concise queries, setting `maxTokens` too low (e.g., < 100) can cause the model to be truncated while still thinking, leaving the final content empty.
   - **Remedy:** The `RuntimeController` implements a fallback that extracts the solution or JSON payload directly from `reasoning_content` if `content` is blank, and defaults to generous token limits (3,072 tokens).

2. **Tool Parameter Parsing in Local llama-server:**
   - When tools are defined, `llama-server.exe` parses tool calls using Jinja templates. If generation is forcefully stopped midway through a JSON tool string, the internal C++ parser can raise a 500 error.
   - **Remedy:** The `ModelAdapter` normalizes tool schemas, and `RuntimeController` captures parse errors and provides actionable error observations back to the agent for recovery.

3. **Single Local Inference Queue:**
   - The local GPU can process one inference stream at a time efficiently. Multi-agent swarms running locally are queued sequentially via `InferenceQueue` (`localConcurrency: 1`), while cloud providers (Groq, OpenAI) support concurrent parallel streams (`cloudConcurrency: 4`).

---

## 3. Recommended Future Enhancements

1. **Embedded Portable Python Runtime:**
   - Bundle a lightweight Python embedded distribution inside `app/tools/python-win/` so users on clean Windows machines do not need a system Python installation.
2. **Streaming Reasoning UI:**
   - Expand the React frontend's thought disclosure panel to display live streaming reasoning deltas (`reasoning:delta` SSE events) with animated syntax highlighting.
3. **Multi-Model Dynamic Swapping:**
   - Support dynamic switching between lightweight fast models (e.g., Qwen 2.5 Coder 1.5B) for simple tool dispatch and deep reasoning models (`AbyxV2 9B`) for architecture design.
