# ABYX Unified AI Studio

ABYX is a fully local, self-contained AI workstation and multi-agent execution harness engineered for Windows 11 with AMD Ryzen and NVIDIA RTX acceleration.

## Architecture Highlights
- **Unified Agent Runtime**: In-process TypeScript/JavaScript SDK orchestrator integrating local GGUF models via llama.cpp and cloud providers.
- **Hardware-Aware Inference Queue**: Serialized GPU dispatching with automatic VRAM budgeting specifically optimized for 8GB VRAM (RTX 5060).
- **Multi-Agent Orchestration**: Role-specialized swarms (Planner, Researcher, Developer, Debugger, Reviewer, Tester) coordinated over dependency DAGs.
- **Central Security Engine & Policy Sandbox**: Triple-tier permissions (Ask, Approve for me, Turbo) with PathGuard path-traversal protection and restricted host execution.
- **Independent Verification & Autonomous Repair**: Multi-gate verification assessing file assertions, build status, test suites, and git diffs before task completion.

## Supported Modalities
- **Text & Code LLMs**: CUDA-accelerated llama.cpp with 262k context, flash attention, and Q4_0 KV caching.
- **Image Generation**: Stable Diffusion CUDA/Vulkan backend.
- **Speech-to-Text**: whisper.cpp local speech transcription.
- **Text-to-Speech**: Kokoro ONNX high-quality local neural synthesis.
