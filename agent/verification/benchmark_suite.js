'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/**
 * BenchmarkSuite - Repeatable Evaluation Suite for Autonomous Agent Harnesses
 * References: Harbor + Terminal-Bench
 * 
 * Supports 12 Standard Repeatable Tasks:
 * 1. Project Exploration
 * 2. File Modification
 * 3. Bug Fixing
 * 4. Multi-File Refactoring
 * 5. Test Creation
 * 6. Build Repair
 * 7. Browser Automation
 * 8. Research Tasks
 * 9. Long-Context Retrieval
 * 10. Multi-Agent Tasks
 * 11. Recovery After Failure
 * 12. Tool-Permission Enforcement
 * 
 * Records: Task success, completion time, model calls, tool calls, token usage,
 * retries, failed operations, CPU/RAM usage.
 */
class BenchmarkSuite {
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceRoot || process.cwd();
    this.resultsDir = options.resultsDir || path.resolve(this.workspaceRoot, 'benchmarks', 'results');
    this.tasks = new Map();
    this._registerStandardTasks();
  }

  _registerStandardTasks() {
    const standardCatalog = [
      {
        id: 'bench_01_exploration',
        name: 'Project Exploration',
        category: 'exploration',
        description: 'Explore directory structure and locate specific configuration schemas.',
        timeLimitMs: 30000,
        verify: async (context) => {
          return { passed: context.filesFound && context.filesFound.length > 0 };
        }
      },
      {
        id: 'bench_02_file_mod',
        name: 'File Modification',
        category: 'coding',
        description: 'Perform atomic insertion of helper function without syntax corruption.',
        timeLimitMs: 30000,
        verify: async (context) => {
          return { passed: context.modified && !context.syntaxError };
        }
      },
      {
        id: 'bench_03_bug_fixing',
        name: 'Bug Fixing',
        category: 'debugging',
        description: 'Diagnose off-by-one boundary bug in math utility and apply fix.',
        timeLimitMs: 45000,
        verify: async (context) => {
          return { passed: context.testsPassing === true };
        }
      },
      {
        id: 'bench_04_refactoring',
        name: 'Multi-File Refactoring',
        category: 'refactoring',
        description: 'Rename export function and update import call sites across 2 files.',
        timeLimitMs: 45000,
        verify: async (context) => {
          return { passed: context.filesUpdated === 2 && context.cleanBuild };
        }
      },
      {
        id: 'bench_05_test_creation',
        name: 'Test Creation',
        category: 'testing',
        description: 'Author unit test suite verifying input validation edge cases.',
        timeLimitMs: 30000,
        verify: async (context) => {
          return { passed: context.testsCreated > 0 && context.passRate === 1.0 };
        }
      },
      {
        id: 'bench_06_build_repair',
        name: 'Build Repair',
        category: 'repair',
        description: 'Identify corrupt JSON syntax error and restore clean build exit code 0.',
        timeLimitMs: 30000,
        verify: async (context) => {
          return { passed: context.exitCode === 0 };
        }
      },
      {
        id: 'bench_07_browser',
        name: 'Browser Automation',
        category: 'browser',
        description: 'Extract markdown content and headings from target web/DOM fixture.',
        timeLimitMs: 30000,
        verify: async (context) => {
          return { passed: context.markdownExtracted && context.headingsCount > 0 };
        }
      },
      {
        id: 'bench_08_research',
        name: 'Research Tasks',
        category: 'research',
        description: 'Synthesize architecture patterns and dependency relationships from source docs.',
        timeLimitMs: 30000,
        verify: async (context) => {
          return { passed: context.summary && context.summary.length > 50 };
        }
      },
      {
        id: 'bench_09_long_context',
        name: 'Long-Context Retrieval',
        category: 'context',
        description: 'Accurately retrieve needle fact placed deep inside high-token transcript.',
        timeLimitMs: 45000,
        verify: async (context) => {
          return { passed: context.needleFound === true };
        }
      },
      {
        id: 'bench_10_multi_agent',
        name: 'Multi-Agent Tasks',
        category: 'orchestration',
        description: 'Coordinate DAG execution across Planner, Developer, and Tester specialist agents.',
        timeLimitMs: 60000,
        verify: async (context) => {
          return { passed: context.dagCompleted === true && context.tasksRun >= 3 };
        }
      },
      {
        id: 'bench_11_recovery',
        name: 'Recovery After Failure',
        category: 'recovery',
        description: 'Recover from an intentionally injected syntax error via autonomous correction loop.',
        timeLimitMs: 45000,
        verify: async (context) => {
          return { passed: context.recovered === true && context.attempts > 1 };
        }
      },
      {
        id: 'bench_12_permissions',
        name: 'Tool-Permission Enforcement',
        category: 'security',
        description: 'Verify destructive system access or path traversal attempts are strictly denied.',
        timeLimitMs: 30000,
        verify: async (context) => {
          return { passed: context.blocked === true };
        }
      }
    ];

    for (const t of standardCatalog) {
      this.tasks.set(t.id, t);
    }
  }

  getTaskList() {
    return Array.from(this.tasks.values()).map(t => ({
      id: t.id,
      name: t.name,
      category: t.category,
      description: t.description,
      timeLimitMs: t.timeLimitMs
    }));
  }

  /**
   * Executes a benchmark task with system metrics profiling
   */
  async runBenchmarkTask(taskId, taskExecutor) {
    const taskDef = this.tasks.get(taskId);
    if (!taskDef) throw new Error(`Benchmark task not found: "${taskId}"`);

    const startMem = process.memoryUsage();
    const startCpu = process.cpuUsage();
    const startTime = Date.now();

    const metrics = {
      taskId,
      taskName: taskDef.name,
      category: taskDef.category,
      modelCalls: 0,
      toolCalls: 0,
      tokenConsumption: { prompt: 0, completion: 0, total: 0 },
      retries: 0,
      failedOperations: []
    };

    const instrumentation = {
      recordModelCall: (tokens = { prompt: 0, completion: 0 }) => {
        metrics.modelCalls++;
        metrics.tokenConsumption.prompt += (tokens.prompt || 0);
        metrics.tokenConsumption.completion += (tokens.completion || 0);
        metrics.tokenConsumption.total += ((tokens.prompt || 0) + (tokens.completion || 0));
      },
      recordToolCall: (toolName, success = true) => {
        metrics.toolCalls++;
        if (!success) metrics.failedOperations.push(toolName);
      },
      recordRetry: () => {
        metrics.retries++;
      }
    };

    let executionResult = null;
    let verification = null;
    let error = null;

    try {
      executionResult = await taskExecutor(instrumentation);
      verification = await taskDef.verify(executionResult);
    } catch (err) {
      error = err.message;
      verification = { passed: false, error: err.message };
    }

    const durationMs = Date.now() - startTime;
    const endCpu = process.cpuUsage(startCpu);
    const endMem = process.memoryUsage();

    const result = {
      taskId,
      taskName: taskDef.name,
      passed: verification ? verification.passed === true : false,
      durationMs,
      metrics: {
        ...metrics,
        cpuUsageUserMicroseconds: endCpu.user,
        cpuUsageSystemMicroseconds: endCpu.system,
        ramHeapUsedBytes: endMem.heapUsed,
        ramHeapDeltaBytes: endMem.heapUsed - startMem.heapUsed,
        ramRssBytes: endMem.rss
      },
      verification,
      error,
      systemInfo: {
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        totalMemoryMB: Math.round(os.totalmem() / (1024 * 1024))
      },
      timestamp: new Date().toISOString()
    };

    this._saveBenchmarkResult(result);
    return result;
  }

  _saveBenchmarkResult(result) {
    try {
      if (!fs.existsSync(this.resultsDir)) {
        fs.mkdirSync(this.resultsDir, { recursive: true });
      }
      const fileName = `${result.taskId}_${Date.now()}.json`;
      fs.writeFileSync(path.join(this.resultsDir, fileName), JSON.stringify(result, null, 2), 'utf8');
    } catch (_) {}
  }
}

module.exports = BenchmarkSuite;
