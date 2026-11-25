/**
 * test/multi_agent_system_test.js
 * Comprehensive Multi-Agent Orchestration & Verification Test Suite for Abyx
 */

const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

const AgentMessageBus = require("../agent/message_bus.js");
const { AgentRegistry } = require("../agent/agent_registry.js");
const WorkspaceIsolationManager = require("../agent/workspace_isolation.js");
const TaskVerifier = require("../agent/verifier.js");
const TaskScheduler = require("../agent/scheduler.js");
const AgentOrchestrator = require("../agent/orchestrator.js");
const AgentSharedMemory = require("../agent/shared_memory.js");
const PathGuard = require("../agent/path_guard.js");

const TEST_DIR = path.resolve("./test/tmp_multiagent");

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

async function runTests() {
  console.log("Starting Multi-Agent System Test Suite...\n");
  cleanup();
  fs.mkdirSync(TEST_DIR, { recursive: true });

  const pathGuard = new PathGuard(TEST_DIR);

  // TEST 1: Agent Registry 12 Specialized Agents
  console.log("Test 1: Agent Registry specialized agents...");
  const registry = new AgentRegistry();
  const allAgents = registry.getAll();
  assert.strictEqual(allAgents.length, 12, "Should have exactly 12 specialized agents");
  const codingAgent = registry.get("coding");
  assert.ok(codingAgent, "Coding agent must exist");
  assert.strictEqual(codingAgent.id, "coding");
  assert.ok(codingAgent.allowedTools.includes("fs_write"));
  console.log("PASS: Registry verified with 12 specialized agents.");

  // TEST 2: Message Bus Typed Events
  console.log("Test 2: Inter-Agent Message Bus pub/sub...");
  const bus = new AgentMessageBus();
  let received = false;
  bus.subscribe("task:assigned", (event) => {
    if (event.payload?.taskId === "t-100") received = true;
  });
  bus.publish("task:assigned", { taskId: "t-100", agentId: "coding" }, "orchestrator");
  assert.strictEqual(received, true, "Message bus subscriber must receive task:assigned event");
  const history = bus.getHistory({ type: "task:assigned" });
  assert.strictEqual(history.length, 1);
  console.log("PASS: Inter-agent message bus event delivery verified.");

  // TEST 3: File Ownership Lock Collision Detection
  console.log("Test 3: File Ownership Lock Collision Detection...");
  const iso = new WorkspaceIsolationManager(pathGuard);
  const targetFile = "src/index.js";
  const lock1 = iso.acquireLock(targetFile, "agent_1");
  assert.strictEqual(lock1.ok, true, "Agent 1 should acquire write lock on src/index.js");

  const lock2 = iso.acquireLock(targetFile, "agent_2");
  assert.strictEqual(lock2.ok, false, "Agent 2 should be blocked by conflict collision");
  assert.strictEqual(lock2.holder, "agent_1");

  iso.releaseLocks("agent_1");
  const lock3 = iso.acquireLock(targetFile, "agent_2");
  assert.strictEqual(lock3.ok, true, "Agent 2 can acquire lock after release");
  iso.releaseLocks("agent_2");
  console.log("PASS: File ownership lock contention and release verified.");

  // TEST 4: Shadow Worktree Staging & Atomic Reconciliation Merge
  console.log("Test 4: Shadow Worktree Staging and Atomic Reconciliation Merge...");
  const stagedFilePath = iso.getShadowPath("coding_agent", "new_feature.js");
  fs.mkdirSync(path.dirname(stagedFilePath), { recursive: true });
  fs.writeFileSync(stagedFilePath, "export const value = 42;\n", "utf8");

  const mergeRes = iso.reconcileAndMerge("coding_agent");
  assert.strictEqual(mergeRes.ok, true, "Reconciliation merge should succeed");
  const finalDest = path.join(TEST_DIR, "new_feature.js");
  assert.ok(fs.existsSync(finalDest), "Merged file must exist in main workspace");
  assert.strictEqual(fs.readFileSync(finalDest, "utf8"), "export const value = 42;\n");
  console.log("PASS: Shadow worktree staging and atomic merge verified.");

  // TEST 5: Independent Verification Engine
  console.log("Test 5: Independent Verification Engine...");
  const verifier = new TaskVerifier({ pathGuard });
  const validFile = "verified_output.js";
  fs.writeFileSync(path.join(TEST_DIR, validFile), "const greeting = 'hello';\nexport default greeting;\n", "utf8");

  const vResult = await verifier.verify({
    expectedFiles: [validFile]
  });
  assert.strictEqual(vResult.passed, true, "Verification of valid file must pass");
  assert.strictEqual(vResult.checks[0].passed, true);
  console.log("PASS: Task verifier file validation verified.");

  // TEST 6: DAG Task Scheduling & Cycle Detection
  console.log("Test 6: DAG Scheduling and Dependency Cycle Detection...");
  const scheduler = new TaskScheduler({ maxConcurrency: 2 });
  scheduler.addTask({ id: "task_1", agentRole: "architecture", dependsOn: [] });
  scheduler.addTask({ id: "task_2", agentRole: "coding", dependsOn: ["task_1"] });
  scheduler.addTask({ id: "task_3", agentRole: "testing", dependsOn: ["task_2"] });
  assert.strictEqual(scheduler.validateGraph(), true);

  const circularScheduler = new TaskScheduler();
  circularScheduler.addTask({ id: "task_a", dependsOn: ["task_b"] });
  circularScheduler.addTask({ id: "task_b", dependsOn: ["task_a"] });
  let cycleThrown = false;
  try {
    circularScheduler.validateGraph();
  } catch (err) {
    if (err.message.includes("Circular")) cycleThrown = true;
  }
  assert.strictEqual(cycleThrown, true, "Circular dependency DAG must be detected and rejected");
  console.log("PASS: DAG validation and cycle prevention verified.");

  // TEST 7: Real Parallel Execution of Independent Tasks
  console.log("Test 7: Real Concurrent Execution of Independent Tasks...");
  const parallelScheduler = new TaskScheduler({ maxConcurrency: 2 });
  const executionLog = [];

  parallelScheduler.addTask({
    id: "p1",
    dependsOn: [],
    executor: async () => {
      const start = Date.now();
      await new Promise(r => setTimeout(r, 60));
      const end = Date.now();
      executionLog.push({ id: "p1", start, end });
      return { ok: true };
    }
  });

  parallelScheduler.addTask({
    id: "p2",
    dependsOn: [],
    executor: async () => {
      const start = Date.now();
      await new Promise(r => setTimeout(r, 60));
      const end = Date.now();
      executionLog.push({ id: "p2", start, end });
      return { ok: true };
    }
  });

  const runResult = await parallelScheduler.execute();
  assert.strictEqual(runResult.status, "completed");
  assert.strictEqual(executionLog.length, 2);
  const [t1, t2] = executionLog;
  const overlap = Math.max(0, Math.min(t1.end, t2.end) - Math.max(t1.start, t2.start));
  assert.ok(overlap > 20, "Tasks must execute concurrently in parallel pool");
  console.log(`PASS: Parallel execution verified with ${overlap}ms timestamp overlap.`);

  // TEST 8: Agent Shared Memory & Dependency Context Injection
  console.log("Test 8: Agent Shared Memory & Dependency Context Injection...");
  const memory = new AgentSharedMemory({ maxTokensPerContext: 1024 });
  memory.recordTaskOutput("t_arch", {
    agentRole: "architecture",
    title: "Database Schema Design",
    summary: "Designed SQLite user credentials table with bcrypt hashing.",
    files: ["src/schema.sql"]
  });

  const depCtx = memory.getDependencyContext(["t_arch"]);
  assert.ok(depCtx.includes("Database Schema Design"), "Dependency context must contain prerequisite task title");
  assert.ok(depCtx.includes("src/schema.sql"), "Dependency context must list produced files");

  const registeredArt = memory.registerArtifact({
    name: "schema.sql",
    type: "file",
    agentId: "architecture",
    taskId: "t_arch",
    summary: "User authentication schema",
    content: "CREATE TABLE users (id TEXT PRIMARY KEY, password_hash TEXT);"
  });
  assert.ok(registeredArt.contentHash, "Artifact should have SHA-256 content hash");
  assert.strictEqual(memory.listArtifacts().length, 1);

  const finding = memory.recordFinding({
    topic: "Password Security",
    conclusion: "Use bcrypt with work factor 12.",
    agentId: "security",
    taskId: "t_arch"
  });
  assert.strictEqual(memory.listFindings().length, 1);
  console.log("PASS: Shared memory context injection and artifact tracking verified.");

  // TEST 9: End-to-End Multi-Agent Orchestration Run
  console.log("Test 9: End-to-End Multi-Agent Orchestration Run...");
  const orchestrator = new AgentOrchestrator({
    pathGuard,
    policyEngine: null,
    fsTool: null,
    terminalTool: null,
    lspTool: null,
    toolRegistry: null,
    toolGateway: null,
    aiProviders: null // Uses high-grade deterministic fallback
  });

  const testFile1 = "auth_output.js";
  const customDAG = [
    {
      id: "task_plan",
      title: "Architecture Specification",
      agentRole: "architecture",
      description: "Define authentication contracts",
      dependsOn: []
    },
    {
      id: "task_code",
      title: "Write Authentication Module",
      agentRole: "coding",
      description: "Implement authentication logic",
      dependsOn: ["task_plan"],
      ownedFiles: [testFile1],
      expectedFiles: [testFile1]
    }
  ];

  // Write file simulating agent completion for verification check
  fs.writeFileSync(path.join(TEST_DIR, testFile1), "export function authenticate(u, p) { return true; }\n", "utf8");

  const sseEvents = [];
  const report = await orchestrator.orchestrate({
    goal: "Implement authentication module",
    customTasks: customDAG,
    concurrency: 2,
    onEvent: (type, payload) => {
      sseEvents.push({ type, payload });
    }
  });

  assert.strictEqual(report.status, "completed");
  assert.strictEqual(report.completedCount, 2);
  assert.ok(sseEvents.some(e => e.type === "orchestration:started"));
  assert.ok(sseEvents.some(e => e.type === "task:completed"));
  assert.ok(sseEvents.some(e => e.type === "orchestration:finished"));
  console.log(`PASS: End-to-end orchestration completed with ${sseEvents.length} SSE events recorded.`);

  // TEST 10: Multi-Agent Concurrency Benchmark
  console.log("Test 10: Multi-Agent Concurrency Benchmark...");
  const benchScheduler = new TaskScheduler({ maxConcurrency: 4 });
  const taskCount = 4;
  const simWorkMs = 50;

  for (let i = 1; i <= taskCount; i++) {
    benchScheduler.addTask({
      id: `bench_${i}`,
      dependsOn: [],
      executor: async () => {
        await new Promise(r => setTimeout(r, simWorkMs));
        return { ok: true };
      }
    });
  }

  const benchStart = Date.now();
  await benchScheduler.execute();
  const benchDuration = Date.now() - benchStart;
  const sequentialBaseline = taskCount * simWorkMs; // 200ms
  // With 4 concurrent workers, 4 * 50ms tasks should finish in ~50-100ms, much faster than 200ms
  assert.ok(benchDuration < sequentialBaseline, `Parallel execution (${benchDuration}ms) must outperform sequential baseline (${sequentialBaseline}ms)`);
  console.log(`PASS: Concurrency benchmark completed in ${benchDuration}ms (sequential baseline: ${sequentialBaseline}ms, ${(sequentialBaseline / benchDuration).toFixed(1)}x speedup).`);

  cleanup();
  console.log("\n==========================================");
  console.log("ALL 10 MULTI-AGENT SUBSYSTEM TESTS PASSED!");
  console.log("==========================================\n");
}

runTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
