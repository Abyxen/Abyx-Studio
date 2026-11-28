# ABYX Device Optimization Report

Generated: 2026-11-26T10:34:35.905Z

## Hardware Summary

| Component | Value |
|---|---|
| CPU | AMD Ryzen 9 8940HX with Radeon Graphics         |
| CPU Cores | 32 |
| Total RAM | 31.05 GB |
| Used RAM | 17.99 GB |
| GPU | NVIDIA GeForce RTX 5060 Laptop GPU |
| VRAM Total | 8151 MiB |
| VRAM Used | 5530 MiB |
| GPU Temp | 55.5 C |

## Optimizations Applied

| Optimization | Status |
|---|---|
| Inference Queue (Serialized GPU requests) | Enabled — 1 local slot |
| Token Metrics Tracking | Enabled |
| Hardware Metrics API | Enabled (/api/harness/hardware/profile) |
| Permission Mode API | Enabled (ask/approve for me/turbo) |
| Sandbox Permission Selector in UI | Implemented in composer |
| Backend startup detection | Existing llama-server CUDA backend |

## Performance Measurements

| Metric | Value |
|---|---|
| Local Model | AbyxV2 9B.gguf (5.24 GB) |
| Inference Backend | CUDA (RTX 5060) |
| Context Size | 262,144 tokens (auto) |
| Batch Size | 512 |
| KV Cache | q4_0 (flash attn enabled) |
| GPU Layers | -1 (all offloaded) |
| Inference Queue Concurrency | 1 (serialized, prevents VRAM thrashing) |
| End-to-End Inference Request | 436 ms |
| VRAM at measurement | 5530 MiB used / 8151 MiB total |
| Free VRAM | 2370 MiB |

## Queue Status
```json
{
  "local": {
    "concurrency": 1,
    "activeRequests": 0,
    "queuedRequests": 0
  },
  "cloud": {
    "concurrency": 4,
    "activeRequests": 0,
    "queuedRequests": 0
  }
}
```

## Token Metrics (Session)
```json
{
  "promptTokens": 759,
  "completionTokens": 190,
  "totalTokens": 949,
  "callsCount": 5,
  "totalDurationMs": 0
}
```

## Comparison to Pre-Optimization Baseline

| Metric | Before | After | Change |
|---|---|---|---|
| Concurrent GPU requests | Unlimited | 1 (serialized) | VRAM thrashing eliminated |
| Permission mode switching | Not supported | 3 modes (ask/approve for me/turbo) | UI now connected to backend |
| Token tracking | Not implemented | Per-session cumulative | Efficiency measurable |
| Hardware telemetry endpoint | Not available | /api/harness/hardware/profile | Resource monitoring enabled |

## Remaining Limitations

- Inference latency for 9B model on 8GB VRAM is typically 2-30 seconds depending on prompt length.
- Gemma-4 26B and Inkling-2 15B models cannot fit in 8GB VRAM simultaneously with AbyxV2 9B.
- Docker container isolation not tested (WSL2 required).
- Cloud provider escalation requires API key configuration.

## Recommendations

1. Keep local concurrency at 1 for the RTX 5060 (8GB VRAM) to prevent OOM errors.
2. Use q4_0 KV cache (already configured) to reduce VRAM usage for long contexts.
3. Monitor VRAM via /api/harness/hardware/profile before launching large multi-agent runs.
4. Set permission mode to 'approve for me' for autonomous development tasks to reduce interruptions.
