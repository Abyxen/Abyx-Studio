# Local Inference Runtimes: llama.cpp vs ONNX Runtime vs OpenVINO

| Feature | llama.cpp | ONNX Runtime | OpenVINO |
|---|---|---|---|
| Primary Focus | LLM / GGUF quantization | Multi-framework graph execution | Intel hardware (CPU/iGPU/NPU) |
| Quantization Formats | GGUF (Q4_K_M, Q8_0, etc.) | INT8, FP16, INT4 AWQ | FP16, INT8, INT4 |
| GPU Acceleration | CUDA, ROCm/HIP, Vulkan, Metal | DirectML, CUDA, TensorRT | OpenCL, OneDNN, NPU driver |
| VRAM Efficiency | Exceptional (KV cache quantization, mmap) | Moderate | High on Intel integrated graphics |
| Setup Complexity | Single self-contained binary | Shared libraries & Python wheels | Model Optimizer + runtime wheels |
