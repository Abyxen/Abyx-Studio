/**
 * ABYX Agentic Engine — Secure Execution Logger & Secret Scrubber
 * 
 * Enforces:
 * - Persistent execution run histories in data/sessions/agent_runs/<runId>.json
 * - Deep scrubbing and redaction of credentials, API keys, passwords, and tokens
 * - Non-destructive audit trail of tool invocations, user approvals, and timeline events
 */

const fs = require('node:fs');
const path = require('node:path');
const { dataDir } = require('../data_paths');

function logsDirectory(profileId = 'prof_default') {
  const pid = String(profileId || 'prof_default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(dataDir, 'profiles', pid, 'agent_runs');
}

// Regex patterns to scrub sensitive data before writing logs
const SECRET_SCRUB_PATTERNS = [
  // OpenAI & general sk- keys
  /sk-[a-zA-Z0-9_\-]{20,}/g,
  // Anthropic API keys
  /sk-ant-[a-zA-Z0-9_\-]{20,}/g,
  // Google Gemini API keys
  /AIza[0-9A-Za-z\-_]{35}/g,
  // Bearer authentication tokens
  /Bearer\s+[a-zA-Z0-9_\-\.]{15,}/gi,
  // Password/token/secret key-value fields (quoted or unquoted)
  /(password|token|secret|apiKey|api_key|credential)\s*[:=]\s*(['"][^'"]+['"]|[^\s,;}]+)/gi,
  // DPAPI vault file references
  /sec_[a-zA-Z0-9_]+\.enc/g
];

class ExecutionLogger {
  constructor(runId = null) {
    this.runId = runId;
  }

  scrub(data) {
    return ExecutionLogger.scrub(data);
  }

  /**
   * Deeply scrubs secrets from strings, objects, or arrays
   */
  static scrub(data) {
    if (data === null || data === undefined) return data;

    if (typeof data === 'string') {
      let scrubbed = data;
      for (const pattern of SECRET_SCRUB_PATTERNS) {
        if (pattern.source.includes('password|token')) {
          scrubbed = scrubbed.replace(pattern, '$1: [REDACTED_SECRET]');
        } else {
          scrubbed = scrubbed.replace(pattern, '[REDACTED_SECRET]');
        }
      }
      return scrubbed;
    }

    if (Array.isArray(data)) {
      return data.map(item => ExecutionLogger.scrub(item));
    }

    if (typeof data === 'object') {
      const result = {};
      for (const [k, v] of Object.entries(data)) {
        const lowerK = k.toLowerCase();
        if (lowerK.includes('password') || lowerK.includes('secret') || lowerK.includes('apikey') || lowerK.includes('api_key') || lowerK.includes('auth_header')) {
          result[k] = '[REDACTED_SECRET]';
        } else {
          result[k] = ExecutionLogger.scrub(v);
        }
      }
      return result;
    }

    return data;
  }

  /**
   * Persists an agent run record to disk with secrets scrubbed
   */
  static saveRun(runRecord) {
    if (!runRecord || !runRecord.id) return;
    try {
      const safeId = String(runRecord.id).replace(/[^a-zA-Z0-9_\-]/g, '_');
      const logsDir = logsDirectory(runRecord.profileId);
      fs.mkdirSync(logsDir, { recursive: true });
      const targetFile = path.join(logsDir, `${safeId}.json`);
      const scrubbedData = ExecutionLogger.scrub(runRecord);
      fs.writeFileSync(targetFile, JSON.stringify(scrubbedData, null, 2), 'utf8');
      return targetFile;
    } catch (err) {
      console.warn('[ExecutionLogger] Warning saving agent run log:', err.message);
      return null;
    }
  }

  /**
   * Loads an agent run record by ID
   */
  static loadRun(runId, profileId = 'prof_default') {
    try {
      const safeId = String(runId).replace(/[^a-zA-Z0-9_\-]/g, '_');
      const targetFile = path.join(logsDirectory(profileId), `${safeId}.json`);
      if (fs.existsSync(targetFile)) {
        return JSON.parse(fs.readFileSync(targetFile, 'utf8'));
      }
    } catch (err) {
      console.warn(`[ExecutionLogger] Error reading run log ${runId}:`, err.message);
    }
    return null;
  }

  /**
   * Lists the most recent agent execution runs
   */
  static listRecentRuns(limit = 20, profileId = 'prof_default') {
    try {
      const logsDir = logsDirectory(profileId);
      if (profileId === 'prof_default') {
        const legacyDir = path.join(dataDir, 'sessions', 'agent_runs');
        if (fs.existsSync(legacyDir) && !fs.existsSync(logsDir)) {
          fs.mkdirSync(path.dirname(logsDir), { recursive: true });
          fs.cpSync(legacyDir, logsDir, { recursive: true, errorOnExist: false, force: false });
        }
      }
      if (!fs.existsSync(logsDir)) return [];
      const files = fs.readdirSync(logsDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          const filePath = path.join(logsDir, f);
          const stat = fs.statSync(filePath);
          return { file: f, path: filePath, mtime: stat.mtime };
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit);

      return files.map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(f.path, 'utf8'));
          return {
            id: data.id,
            sessionId: data.sessionId,
            goal: data.goal,
            status: data.status,
            stepsExecuted: data.stepsExecuted || 0,
            startTime: data.startTime,
            endTime: data.endTime,
            toolsCount: data.toolsExecuted || 0
          };
        } catch (e) {
          return null;
        }
      }).filter(Boolean);
    } catch (e) {
      return [];
    }
  }
}

module.exports = ExecutionLogger;
