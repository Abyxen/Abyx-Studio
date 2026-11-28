# ABYX — Comprehensive Security & Boundary Verification

**Audit Authority:** Independent Verification & QA  
**Scope:** PathGuard Containment, PolicyEngine Gateways, Terminal Isolation, SSRF Prevention, Credential Protection, and Audit Trail Verification.

---

## 1. Boundary & Containment Security (PathGuard)
PathGuard validates all file access attempts against approved roots:
- `../` and `..\\` directory traversal rejected with `Security Violation: Path traverses outside approved workspace boundaries and roots (denied)`.
- Null-byte injection (`\0`) rejected.
- Direct Windows system paths (`C:\Windows\System32`, `C:\Program Files`, etc.) strictly blocked.
- Absolute paths resolved and canonicalized via `fs.realpathSync.native`.
- Atomic writes implemented via `.abyx-<uuid>.tmp` temporary files with `0o600` permissions and sha256 hash validation to prevent race conditions and concurrent clobbering.

## 2. Policy & Permission Engine
- **Plan Mode:** When `mode === 'plan'`, non-read-only tools are denied with: `Tool "${toolName}" is not permitted in PLAN MODE. Plan mode is strictly read-only.`
- **Approval Scoping:** Human-in-the-loop approvals are bound to the exact `{ tool, command, cwd }` tuple, single-use only, and expire automatically after timeout.
- **Shell Grammar Allowlist:** `parseCommand` rejects shell metacharacters `;&|<>$\r\n\0^!` to prevent command chaining, subshell execution, or environment pollution.

## 3. Terminal Execution Sanitization
- `TerminalTool.prototype.getSanitizedEnv` removes all sensitive keys matching:
  - `/API[_-]?KEY/i`
  - `/TOKEN/i`
  - `/SECRET/i`
  - `/PASSWORD/i`
  - `/PRIVATE[_-]?KEY/i`
  - `/AWS_/i`, `/AZURE_/i`, `/GCP_/i`, `/GITHUB_/i`
- Preserves only essential host system environment variables (`PATH`, `SYSTEMROOT`, `COMSPEC`, etc.).

## 4. SSRF & Network Protection
- `ControlledBrowserTool` and `PolicyEngine` block all local loopback, link-local, and private IP ranges:
  - `localhost` (except explicit local studio on port 1420)
  - `127.0.0.1` / `0.0.0.0`
  - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
  - `169.254.0.0/16` (Cloud metadata service)
  - `file://` protocol

## 5. Audit Logging & Non-Repudiation
- All execution attempts, tool calls, and human approvals are permanently recorded in structured JSONL audit files (`ExecutionLogger.saveRun(run)`), scrubbed of sensitive secrets before write.
