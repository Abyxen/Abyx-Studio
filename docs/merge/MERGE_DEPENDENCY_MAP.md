# ABYX Unified AI Studio — Merge Dependency Map

**Canonical Root:** `C:\Users\abira\Documents\Local Ai studio Abyx`  
**Date:** 2026-11-26  

---

## 1. Node.js Dependency Consolidation

| Package | Source Repository | Purpose in Unified System | Target `package.json` Section |
|---|---|---|---|
| `electron` | `Local Ai studio Abyx` | Desktop runtime shell (v45.5.0) | `devDependencies` |
| `electron-builder` | `Local Ai studio Abyx` | Windows installer & NSIS packager (v26.18.0) | `devDependencies` |
| `ws` | `Open Abyx` | Real-time WebSocket server for events & remote UI (v8.23.0) | `dependencies` |
| `playwright` | `Open Abyx` | Autonomous browser automation (Chromium headless) (v1.65.1) | `dependencies` |

## 2. Python Environment Requirements (Installed & Verified)

All document tools execute via the host Python 3.15 runtime (`python.exe`):
- `reportlab`: Binary `%PDF-1.4` document compilation.
- `python-docx`: Microsoft Word OOXML document generation.
- `openpyxl`: Microsoft Excel spreadsheet with formula evaluation.
- `python-pptx`: Microsoft PowerPoint slide deck generation.
- `Pillow`: Image creation, resizing, and manipulation.

## 3. Hardware & Binary Runtimes (Preserved in `Local Ai studio Abyx`)

- `app/backend/win/cuda/llama-server.exe`: Bundled llama.cpp CUDA server powering port 10086 on the NVIDIA RTX 5060 GPU.
- `app/llm-models/AbyxV2 9B.gguf`: Bundled default 9B model file.
- `app/tools/node-win/`: Bundled portable Node.js runtime for the standalone distribution.
- SQLite3: Native Node.js bindings utilized by `db.js` for zero-configuration persistent storage.
