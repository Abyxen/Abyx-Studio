'use strict';

/**
 * AutonomousRecovery - Bounded Error Recovery & Self-Correction Loop
 * References: OpenHands + Harbor
 * 
 * When a task execution or verification fails:
 * 1. Collects error and isolates the failing operation.
 * 2. Preserves current state via snapshot.
 * 3. Formulates structured feedback for the responsible agent.
 * 4. Runs bounded correction attempts (default max 3).
 * 5. Re-executes verification.
 * 6. Honestly reports unresolved failures if correction budget is exhausted.
 */
class AutonomousRecovery {
  constructor(options = {}) {
    this.maxAttempts = options.maxAttempts || 3;
    this.gitAdapter = options.gitAdapter || null;
    this.logger = options.logger || console;
  }

  /**
   * Orchestrates the self-correction loop
   */
  async executeWithSelfCorrection({
    task,
    executor, // async (feedback, attempt) => result
    verifier, // async (result) => verificationResult ({ passed: boolean, error?: string })
    onAttempt = null
  }) {
    let attempt = 0;
    let lastError = null;
    let lastResult = null;
    let lastVerification = null;
    const history = [];

    while (attempt < this.maxAttempts) {
      attempt++;
      
      // Preserve current state snapshot if git adapter is available
      let snapshotId = null;
      if (this.gitAdapter && typeof this.gitAdapter.createSnapshot === 'function') {
        try {
          snapshotId = await this.gitAdapter.createSnapshot();
        } catch (_) {}
      }

      // Prepare feedback from previous failure if any
      let feedback = null;
      if (lastError || (lastVerification && !lastVerification.passed)) {
        feedback = this.formatCorrectionFeedback({
          attempt,
          maxAttempts: this.maxAttempts,
          error: lastError,
          verification: lastVerification,
          task
        });
      }

      if (typeof onAttempt === 'function') {
        onAttempt({ attempt, maxAttempts: this.maxAttempts, feedback });
      }

      // Execute correction attempt
      try {
        lastResult = await executor(feedback, attempt);
        lastError = null;
      } catch (execErr) {
        lastError = execErr;
        lastResult = null;
        history.push({
          attempt,
          phase: 'execution',
          error: execErr.message,
          snapshotId
        });
        continue;
      }

      // Run verification
      try {
        lastVerification = await verifier(lastResult);
        if (lastVerification && lastVerification.passed) {
          return {
            ok: true,
            recovered: attempt > 1,
            attempts: attempt,
            result: lastResult,
            verification: lastVerification,
            history
          };
        }

        history.push({
          attempt,
          phase: 'verification',
          failures: lastVerification.failures || [lastVerification.error || 'Verification check failed'],
          snapshotId
        });
      } catch (verifErr) {
        lastError = verifErr;
        history.push({
          attempt,
          phase: 'verifier_exception',
          error: verifErr.message,
          snapshotId
        });
      }
    }

    // Bounded attempts exhausted; report failure honestly
    return {
      ok: false,
      recovered: false,
      attempts: attempt,
      maxAttempts: this.maxAttempts,
      error: `Deliverable failed verification after ${attempt} bounded correction attempts.`,
      lastError: lastError ? lastError.message : (lastVerification ? (lastVerification.error || JSON.stringify(lastVerification.failures)) : 'Unknown failure'),
      lastVerification,
      history
    };
  }

  /**
   * Builds actionable correction feedback for the responsible agent
   */
  formatCorrectionFeedback({ attempt, maxAttempts, error, verification, task }) {
    const lines = [
      `[Verification Failure - Correction Attempt ${attempt}/${maxAttempts}]`,
      `Task: ${task?.goal || task?.description || 'Deliverable implementation'}`
    ];

    if (error) {
      lines.push(`Execution Error: ${error.message || error}`);
    }

    if (verification) {
      if (verification.failures && verification.failures.length > 0) {
        lines.push('Failing Verification Checks:');
        for (const f of verification.failures) {
          lines.push(`  - ${f}`);
        }
      } else if (verification.error) {
        lines.push(`Verification Error: ${verification.error}`);
      }
    }

    lines.push('Directive: Resolve the reported failure directly in the affected files without reverting completed requirements.');
    return lines.join('\n');
  }
}

module.exports = AutonomousRecovery;
