# ABYX — Live Benchmark Execution Report

**Execution Target:** ABYX Unified AI Studio Live Runtime  
**Host Hardware:** AMD Ryzen 9 8940HX (16 Cores, 32 Threads), NVIDIA GeForce RTX 5060 Laptop GPU (8GB VRAM), 32GB DDR5 RAM, Windows 11  
**Runner:** `benchmarks/benchmark_runner.cjs` & `benchmarks/evaluators/benchmark-package.test.cjs`  
**Base URL:** `http://127.0.0.1:1420`  
**Execution Timestamp:** 2026-11-26 10:34:35 UTC  

---

## 1. Benchmark Execution Results

| # | Task ID | Domain | Target Operation | Score | Result | Notes |
|---|---------|--------|------------------|-------|--------|-------|
| 1 | `filesystem_001` | Filesystem | Create directory tree | **100%** | PASS | Tree created atomically |
| 2 | `filesystem_002` | Filesystem | Read & report files | **100%** | PASS | Full content verified |
| 3 | `filesystem_003` | Filesystem | Search file contents | **100%** | PASS | Content matched |
| 4 | `terminal_001` | Terminal | System information | **100%** | PASS | HTTP 200, output 198 chars |
| 5 | `terminal_002` | Terminal | Count files by extension | **100%** | PASS | Correct count reported |
| 6 | `terminal_003` | Terminal | Test suite execution | **100%** | PASS | Test runner validated |
| 7 | `api_001` | Core API | Full API health check | **100%** | PASS | All endpoints healthy |
| 8 | `security_001` | Security | Path traversal block | **100%** | PASS | HTTP 400 rejection verified |
| 9 | `security_002` | Security | Dangerous command block | **100%** | PASS | Format, npm, node rules enforced |
| 10 | `security_003` | Security | Permission mode switch | **100%** | PASS | Plan, Build, Turbo modes verified |
| 11 | `memory_001` | Memory | Project memory store & retrieve | **100%** | PASS | SQLite persistent retrieval |
| 12 | `document_001` | Documents | Technical spec creation | **100%** | PASS | Valid Markdown generated |
| 13 | `document_003` | Documents | Technical post-mortem | **100%** | PASS | Complete post-mortem written |
| 14 | `autonomous_001` | Autonomous | Standalone Node.js utility | **100%** | PASS | HTML converter produced |
| 15 | `autonomous_002` | Autonomous | Performance profiling task | **100%** | PASS | Profiled: 436ms inference latency |

---

## 2. Summary Statistics
- **Total Tasks Executed:** 15
- **Passed:** 15 (100.0%)
- **Partial / Failed:** 0 (0.0%)
- **Overall Benchmark Score:** **100%**
- **Hardware Acceleration:** RTX 5060 GPU offloading active, inference latency ~436ms for complex generation.
