# ABYX UNIFIED AI STUDIO — OPENCODE UI RECONSTRUCTION REPORT

## 1. Visual & Architectural Design Philosophy

The reconstructed Abyx interface is built upon the OpenCode developer workspace design language:
- **Monochromatic Dark Palette:** High-contrast, low-distraction dark theme (`#0c0d12` canvas, `#12141c` elevated panels, `#1b1e28` interactive surfaces) with subtle 1px borders (`rgba(255,255,255,0.08)`).
- **Strictly Zero Decorative Emojis:** All status badges, agent roles, and action triggers utilize clean SVG line icons (Lucide React) and monochrome typography.
- **Monospace Precision:** File paths, command strings, git hashes, token counts, and execution latencies are rendered in monospace typography (`JetBrains Mono` / `SF Mono` / `Courier`).
- **Responsive 3-Pane Layout:** Designed for professional multi-agent software engineering with immediate access to project context, live timeline streaming, and real-time telemetry.

---

## 2. Three-Pane Architecture Breakdown

### 2.1 Left Pane — Workspace, Sessions & Modes (Width: 288px)
- **Project Workspace Header:** Displays active project name, root filesystem path, and quick refresh trigger.
- **Execution Mode Toggle:**
  - `Build`: Full autonomous implementation, tool execution, and verification.
  - `Plan`: Architectural goal decomposition, task review, and manual approval.
  - `Swarm`: Parallel exploration across multiple worker agents.
- **Session & Run History:** Queries [task_store.js](file:///C:/Users/abira/Documents/Local%20Ai%20studio%20Abyx/agent/task_store.js) via `/api/orchestrator/history`. Displays past orchestration runs with run ID, status badge, task count, and duration. Clicking any run instantly restores its DAG, findings, and deliverables in the workspace.
- **Hardware & Model Status Pill:**
  - Real-time indicator: `Backend Online • CUDA`
  - System summary: `AMD Ryzen 9 8940HX (16c) • RTX 5060 Laptop (8GB VRAM)`
  - Active model: `AbyxV2 9B.gguf • Port 10086`

### 2.2 Center Pane — Execution Timeline & Sticky Bottom Composer (Flex: 1)
- **Top Header Bar:** Shows active Run ID, live agent count, completion progress bar, elapsed duration counter, and a red `Stop Swarm` button.
- **Scrollable Event Stream:**
  - **Mission Card:** Displays user goal, model, and concurrency.
  - **DAG Formed Card:** Grid of decomposed subtasks, agent role badges, and prerequisite dependencies.
  - **Agent Step Cards:** Live step count (`Step 1/5`), agent role badge, and reasoning output.
  - **Tool Call Cards:** Shows invoked tool name (`fs_write`, `fs_read`, `execute_terminal_command`, `lsp_diagnostics`), input arguments, execution status, and formatted output.
  - **Deliverable Cards:** Staged file changes with LSP syntax verification status.
- **Sticky Bottom OpenCode Composer:**
  - **Quick `@agent` Pills:** Clicking `@architecture`, `@coding`, `@testing`, `@research`, `@debugging`, `@code_review`, `@documentation`, or `@file_ops` automatically inserts `@role` into the input.
  - **Auto-Grow Textarea:** Non-blocking input for assigning objectives.
  - **Concurrency Selector:** 1, 2, 4, 6, or 8 parallel worker agents.
  - **Permission Policy Selector:**
    - `Auto`: Full autonomous execution without manual prompts.
    - `Manual`: Pauses and requests confirmation before destructive file modifications or shell executions.
    - `Bypass`: Non-interactive mode for automated CI runs.
  - **Launch Trigger:** High-contrast `Launch Swarm` button with Enter-key dispatch.

### 2.3 Right Pane — Command Center & Inspector (Width: 384px)
The right pane houses five tabs:
1. **DAG Task Graph (`DAG`):** Displays all subtasks with color-coded status badges (`Pending`, `Running`, `Verifying`, `Completed`, `Failed`), prerequisite linkages, owned files, and detailed outputs on click.
2. **Diff Reviewer (`Diffs`):** Lists staged file modifications with pre-flight LSP syntax check indicators (`LSP Validated`), line-by-line diff previews, and rollback actions.
3. **Shared Memory Matrix (`Matrix`):** Inter-agent knowledge base showing findings, technical decisions, and deliverable artifacts recorded by specialized agents during the workflow.
4. **Tool Audit Stream (`Audit`):** Real-time chronological audit trail of every tool call, including parameters, execution timestamps, and results.
5. **Hardware & Model Configuration (`Config`):** Direct implementation of the exact controls from the user's hardware settings:
   - System prompt (editable textarea)
   - Context size slider (0 to 32,768 / up to 256k)
   - Temperature slider (0.0 to 1.5, recommended 0.7)
   - Max response tokens toggle (Auto / Manual) with slider
   - Seed input (-1 for random)
   - Performance profile buttons (Potato, Balanced, High, Custom)
   - Text backend buttons (CUDA, VULKAN, CPU only)
   - CPU threads slider (1 to 32)
   - GPU layers slider (0 to 50 / All)
   - Batch size slider (128 to 2048)
   - KV cache buttons (Q4_0, Q8_0, F16)
   - Save Harness Settings button with live feedback.
