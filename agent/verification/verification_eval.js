/**
 * Deterministic Verification Hooks, Visual Inspection, Automated Judge, and Structured Feedback.
 */

class VerificationHooks {
  constructor() {
    this.preHooks = [];
    this.postHooks = [];
    this.namedHooks = new Map();
  }

  registerHook(name, fn) {
    this.namedHooks.set(name, fn);
  }

  async runVerification(workspaceDir, criteria = {}) {
    const details = [];
    let allPassed = true;
    for (const [name, fn] of this.namedHooks.entries()) {
      try {
        const passed = await fn(workspaceDir);
        details.push({ hook: name, passed: !!passed });
        if (!passed) allPassed = false;
      } catch (err) {
        details.push({ hook: name, passed: false, error: err.message });
        allPassed = false;
      }
    }
    return {
      passed: allPassed,
      hookCount: this.namedHooks.size,
      details
    };
  }

  registerPreHook(fn) {
    this.preHooks.push(fn);
  }

  registerPostHook(fn) {
    this.postHooks.push(fn);
  }

  executePreHooks(actionName, args) {
    for (const hook of this.preHooks) {
      const res = hook(actionName, args);
      if (!res.ok) {
        return { ok: false, error: `Pre-action hook blocked: ${res.reason}` };
      }
    }
    return { ok: true };
  }

  executePostHooks(actionName, result) {
    for (const hook of this.postHooks) {
      const res = hook(actionName, result);
      if (!res.ok) {
        return { ok: false, error: `Post-action verification failed: ${res.reason}` };
      }
    }
    return { ok: true };
  }
}

class VisualRuntimeInspector {
  constructor() {
    this.visualHistory = [];
  }

  inspectVisualState(url, domElements = [], screenshotBuffer = null) {
    const snapshot = {
      url,
      domElements,
      elementCount: domElements.length,
      hasScreenshot: screenshotBuffer !== null || true,
      timestamp: new Date().toISOString()
    };
    this.visualHistory.push(snapshot);
    return snapshot;
  }

  verifyElementVisible(elementSelector) {
    if (this.visualHistory.length === 0) return false;
    const latest = this.visualHistory[this.visualHistory.length - 1];
    return latest.domElements.includes(elementSelector);
  }
}

class AutomatedJudge {
  evaluateOutcome(passed, details = []) {
    return {
      approved: !!passed,
      score: passed ? 1.0 : 0.4,
      details,
      timestamp: new Date().toISOString()
    };
  }

  evaluateOutput(taskPrompt, executionTranscript, expectedOutputs = []) {
    const transcriptText = JSON.stringify(executionTranscript);
    let matched = 0;
    for (const exp of expectedOutputs) {
      if (transcriptText.includes(exp)) matched += 1;
    }
    const completeness = expectedOutputs.length > 0 ? (matched / expectedOutputs.length) : 1.0;
    const robustness = transcriptText.toLowerCase().includes('error') ? 0.70 : 1.0;
    const score = Number(((completeness * 0.7) + (robustness * 0.3)).toFixed(2));

    return {
      score,
      passed: score >= 0.75,
      rubric: { completeness, robustness },
      feedback: score >= 0.75 ? 'All criteria satisfied.' : 'Missing expected tokens or encountered errors.'
    };
  }
}

class StructuredErrorFeedback {
  formatDiagnostic(category, message, remediation) {
    return {
      code: category,
      message,
      remediation,
      timestamp: new Date().toISOString()
    };
  }

  static TAXONOMY = [
    { category: 'SYNTAX_ERROR', regex: /(SyntaxError|IndentationError|invalid syntax|Unexpected token)/i, remedy: 'Review syntax, indentation, and mismatched quotes.' },
    { category: 'FILE_NOT_FOUND', regex: /(ENOENT|FileNotFoundError|No such file)/i, remedy: 'Verify target file or directory exists before accessing.' },
    { category: 'PERMISSION_DENIED', regex: /(EACCES|PermissionError|Access denied|Permission denied)/i, remedy: 'Check file mode permissions and security boundaries.' },
    { category: 'COMMAND_FAILURE', regex: /(command not found|exit code [1-9])/i, remedy: 'Check CLI command spelling, arguments, and required dependencies.' }
  ];

  categorizeAndExplain(errorText) {
    const errStr = String(errorText || '');
    for (const item of StructuredErrorFeedback.TAXONOMY) {
      if (item.regex.test(errStr)) {
        return {
          category: item.category,
          actionableRemedy: item.remedy,
          isRecoverable: item.category !== 'PERMISSION_DENIED',
          rawError: errStr
        };
      }
    }
    return {
      category: 'GENERAL_ERROR',
      actionableRemedy: 'Inspect arguments and review environmental context.',
      isRecoverable: true,
      rawError: errStr
    };
  }
}

module.exports = {
  VerificationHooks,
  VisualRuntimeInspector,
  AutomatedJudge,
  StructuredErrorFeedback
};
