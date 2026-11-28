/**
 * Goal & Autonomous Execution Orchestrator
 * Implements functional equivalents of /goal, /plan, and /code:
 * - Bounded iterative execution
 * - Automated self-evaluation against acceptance criteria
 * - Dynamic plan revision and automatic completion termination
 */


class GoalOrchestrator {
  constructor(workspaceRoot = process.cwd(), options = {}) {
    this.workspaceRoot = workspaceRoot;
    this.maxIterations = options.maxIterations || 10;
    this.costBudget = options.costBudget || 2.0;
    this.engine = options.engine || null;
  }

  async executeGoal(goalDescription, acceptanceCriteria = [], onProgress = null) {
    const engine = this.engine;
    if (!engine?.executionLoop || !engine?.verificationEngine) {
      return { goalDescription, achieved: false, status: 'blocked', iterations: 0,
        error: 'A configured agent engine with a model provider and verification engine is required.' };
    }

    const run = await engine.executionLoop.run({
      goal: goalDescription,
      maxSteps: this.maxIterations,
      mode: 'build',
      onEvent: (type, data) => onProgress?.({ stage: type, data })
    });
    const checks = Array.isArray(acceptanceCriteria) ? acceptanceCriteria : [];
    const verification = checks.length
      ? await engine.verificationEngine.runSuite({ steps: checks })
      : { passed: false, reason: 'No machine-verifiable acceptance criteria were supplied.' };

    return {
      goalDescription,
      iterations: run.stepCount || 0,
      achieved: run.ok === true && run.completed === true && verification.passed === true,
      status: verification.passed ? (run.ok ? 'verified' : 'failed') : 'requires_verification',
      run,
      verification
    };
  }

  /**
   * /loop command: Executes an iterative loop until a condition is satisfied or max iterations reached
   */
  async executeLoop(taskDescription, conditionCheck = null, maxIterations = 5) {
    const results = [];
    let completed = false;

    for (let iter = 1; iter <= maxIterations; iter++) {
      const stepGoal = `${taskDescription} (Iteration ${iter}/${maxIterations})`;
      const res = await this.executeGoal(stepGoal, []);
      results.push({ iteration: iter, result: res });

      if (typeof conditionCheck === 'function') {
        const passed = await conditionCheck(res, iter);
        if (passed) {
          completed = true;
          break;
        }
      }
    }

    return {
      taskDescription,
      iterationsRun: results.length,
      completed,
      history: results
    };
  }

  /**
   * /batch command: Executes a batch of tasks concurrently or sequentially across specialist agents
   */
  async executeBatch(tasks = [], options = {}) {
    const concurrency = options.concurrency || 2;
    const results = [];

    for (let i = 0; i < tasks.length; i += concurrency) {
      const chunk = tasks.slice(i, i + concurrency);
      const chunkResults = await Promise.all(
        chunk.map(task => this.executeGoal(typeof task === 'string' ? task : task.goal, task.criteria || []))
      );
      results.push(...chunkResults);
    }

    return {
      totalTasks: tasks.length,
      results,
      allPassed: results.every(r => r.achieved)
    };
  }
}

module.exports = { GoalOrchestrator };
