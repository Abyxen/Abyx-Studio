# ABYX — HARDWARE OPTIMIZATION AUDIT

## 1. Live System Measurements (Verified via `nvidia-smi`, CIM, & `/api/harness/hardware/profile`)
- **CPU:** AMD Ryzen 9 8940HX with Radeon Graphics (16 Cores / 32 Logical Processors)
- **RAM:** 31.05 GB Total (`14.89 GB`–`16.16 GB` free during baseline)
- **GPU:** NVIDIA GeForce RTX 5060 Laptop GPU
- **VRAM:** 8,151 MiB Total | 5,946 MiB Used (with `AbyxV2 9B.gguf` loaded) | 1,954 MiB Free | 50.75°C | 0% idle util
- **Local Inference Server (`127.0.0.1:10086`):**
  - Process: `llama-server.exe` (CUDA backend)
  - Model: `AbyxV2 9B.gguf` (5.24 GB, Q4_K - Medium)
  - Flags verified in daemon log: `--ctx-size 262144 --threads 16 --n-gpu-layers -1 --parallel 1 --cache-type-k q4_0 --cache-type-v q4_0 --cache-prompt --batch-size 512 --ubatch-size 512 --flash-attn on --load-mode mmap`

## 2. Optimization Verification
| Optimization | Implementation | Verification | Status |
|---|---|---|---|
| Single Local Model Instance | `llama-server.exe` PID 33376 on port 10086 | `netstat -ano` confirms 1 instance; 1,954 MiB free VRAM cannot host a 2nd model | VERIFIED |
| Serialized GPU Queue | `InferenceQueue` in `agent/model_router.js` (`localQueue` concurrency=1, `cloudQueue` concurrency=4) | `/api/harness/hardware/profile` reports `local.concurrency: 1` | VERIFIED |
| Hardware Telemetry | `getHardwareMetrics()` with 3s cache TTL | Returned live RTX 5060 VRAM & temp | VERIFIED |
| Windows Path & PowerShell | `PathGuard` + `TerminalTool` | PowerShell execution & path containment verified | VERIFIED |
| Docker / WSL2 Integration | `SandboxManager.getStatus()` | Host has neither Docker nor WSL2; cleanly reports `restricted_process` | VERIFIED |
