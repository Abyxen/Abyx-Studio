# Architectural Comparison: llama.cpp vs Ollama

## Core Foundations
- **llama.cpp**: Pure C/C++ inference engine with direct hardware backends (CUDA, Vulkan, SYCL, Metal). Directly executes GGUF models with minimal memory overhead and zero background daemon requirement.
- **Ollama**: Go-based application wrapper around llama.cpp that introduces container-like model tagging (Modelfiles), a REST API daemon, and automatic model pulling from the Ollama registry.

## ABYX Design Decision
ABYX integrates `llama-server.exe` directly via custom process management and `model_router.js`. This eliminates Go runtime overhead, avoids duplicate port managers, and affords total control over batch sizes, KV quantization, and thread affinity on the Ryzen 9 8940HX + RTX 5060.
