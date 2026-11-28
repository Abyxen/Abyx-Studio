# ABYX Unified AI Studio — Tool Registry & Capabilities

## 1. Overview

Tools in ABYX Unified AI Studio are accessible to agents through `ToolGateway` (`agent/tool_gateway.js`) and `HarnessContext` (`harness/index.js`). Every tool invocation is subject to:
1. **Schema Validation:** Argument types and mandatory fields verified against JSON schema declarations.
2. **Policy Evaluation:** Mode constraints (Plan Mode denies destructive edits; Build Mode allows governed writes).
3. **Sandbox Isolation:** Enforced canonical path boundaries via `PathGuard` preventing traversal attacks.
4. **Context Output Filtering:** Truncation of large outputs to safeguard model context limits.

---

## 2. Complete Tool Catalog

### 2.1 File System Primitives

#### `read_file`
- **Description:** Reads UTF-8 content of a workspace file within approved boundaries.
- **Parameters:**
  - `path` (string, required): Relative or absolute path to the target file.
  - `startLine` (number, optional): Starting line index (1-based).
  - `endLine` (number, optional): Ending line index (inclusive).
- **Security:** Validated by `PathGuard.resolveSafePath()`.

#### `write_file`
- **Description:** Creates or overwrites a file with new content.
- **Parameters:**
  - `path` (string, required): Relative or absolute path to the target file.
  - `content` (string, required): UTF-8 content to write.
- **Security:** Denied in Plan Mode; path must resolve within approved roots.

#### `smart_file_editor`
- **Description:** Intelligent file editing supporting atomic creation, search/replace blocks, and append operations.
- **Parameters:**
  - `action` (string, required): `"write"`, `"patch"`, `"append"`, or `"read"`.
  - `path` (string, required): Target file path.
  - `content` (string, optional): New file content.
  - `find` (string, optional): Target substring to locate for patch replacement.
  - `replace` (string, optional): Replacement string for patch operation.

#### `search_content` / `search_files`
- **Description:** Grep-like content search across workspace files.
- **Parameters:**
  - `query` (string, required): Regex or substring search query.
  - `dir` (string, optional): Subdirectory to restrict search.
  - `extensions` (array, optional): List of file extensions to include (e.g., `[".js", ".json"]`).

---

### 2.2 Execution & Terminal

#### `terminal` / `run_command`
- **Description:** Executes a shell command inside the task workspace.
- **Parameters:**
  - `command` (string, required): Command string to execute.
  - `cwd` (string, optional): Working directory for execution.
  - `timeoutMs` (number, optional): Maximum runtime before termination (default: 30000ms).
- **Security:** Dangerous command blacklist (`rm -rf /`, `format`, fork bombs); non-zero exit codes recorded in observations.

#### `process_manager`
- **Description:** Spawns and supervises detached, persistent background daemon processes.
- **Parameters:**
  - `action` (string, required): `"spawn"`, `"stop"`, `"status"`, or `"list"`.
  - `name` (string, required): Identifier for the process.
  - `command` (string, optional): Executable binary path.
  - `args` (array, optional): Command line arguments.

---

### 2.3 Browser Automation & Internet Research

#### `playwright_browser`
- **Description:** Headless Chromium automation via Playwright for live web interactions.
- **Parameters:**
  - `action` (string, required): `"navigate"`, `"click"`, `"type"`, `"screenshot"`, `"content"`, or `"evaluate"`.
  - `url` (string, optional): Web URL to navigate to.
  - `selector` (string, optional): DOM CSS selector for click/type/read operations.
  - `text` (string, optional): Input text for type actions.
  - `screenshotPath` (string, optional): Destination file path for PNG screenshots.

#### `internet_research`
- **Description:** Multi-source web search and document synthesizer with automated academic and web citations.
- **Parameters:**
  - `action` (string, required): `"search_and_synthesize"`, `"fetch_page"`, or `"download_resource"`.
  - `topic` (string, optional): Research query topic.
  - `sources` (array, optional): Specific URLs to query and synthesize.
  - `url` (string, optional): Specific resource URL to fetch or download.

---

### 2.4 Document & Media Generation

#### `advanced_doc_generator` / `generate_document`
- **Description:** High-fidelity multi-format binary document creator backed by ReportLab, python-docx, openpyxl, python-pptx, and Pillow.
- **Supported Formats:**
  1. **PDF (`tool: "pdf"`):** Structured ReportLab Flowables, custom margins, title styles, bullet lists, and tables.
  2. **DOCX (`tool: "docx"`):** Microsoft Word document with headings, paragraphs, and formatted tables.
  3. **XLSX (`tool: "xlsx"`):** Excel workbook with styled headers, data rows, and live uppercase formulas (`=AVERAGE()`, `=SUM()`).
  4. **PPTX (`tool: "pptx"`):** PowerPoint slide deck with title banners, slide layouts, and structured bullet cards.
  5. **Image (`tool: "image"`):** Clean PNG graphics generation with custom dimensions and background fills.
  6. **ZIP (`tool: "zip"`):** Archive compression and extraction with automated SHA-256 integrity checksum calculation.
