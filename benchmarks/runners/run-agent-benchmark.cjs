'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BENCHMARK_ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(BENCHMARK_ROOT, 'tasks', 'catalog.json');
const RESULTS_PATH = path.join(BENCHMARK_ROOT, 'results', 'agent-runs.json');
const LATEST_PATH = path.join(BENCHMARK_ROOT, 'results', 'latest-task-results.json');
const CSV_PATH = path.join(BENCHMARK_ROOT, 'reports', 'TASK_LEVEL_RESULTS.csv');
const MAX_TRACE_BYTES = 8 * 1024 * 1024;
const SECRET_PATTERNS = [
  /\bBearer\s+[^\s"']+/gi,
  /\b(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/g,
  /((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;"']+/gi
];

function scrub(value) {
  if (typeof value === 'string') {
    return SECRET_PATTERNS.reduce((text, pattern, index) => text.replace(pattern, index === 2 ? '$1[REDACTED]' : '[REDACTED]'), value);
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
  return value;
}

function parseArgs(argv) {
  const result = { taskIds: [], category: null, dryRun: false, list: false, model: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--task') result.taskIds.push(...String(argv[++index] || '').split(',').filter(Boolean));
    else if (arg === '--category') result.category = String(argv[++index] || '').toUpperCase();
    else if (arg === '--model') result.model = String(argv[++index] || '');
    else if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--list') result.list = true;
    else if (arg === '--help') result.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return result;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(tempPath, filePath);
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeTaskCsv(rows) {
  const columns = ['taskId', 'category', 'difficulty', 'status', 'score', 'durationMs', 'toolCalls', 'model', 'provider', 'verification', 'failureClass', 'error'];
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map(column => csvCell(row[column])).join(','));
  fs.mkdirSync(path.dirname(CSV_PATH), { recursive: true });
  fs.writeFileSync(CSV_PATH, `${lines.join('\r\n')}\r\n`, 'utf8');
}

function getTasks(catalog, args) {
  let tasks = catalog;
  if (args.taskIds.length) {
    const wanted = new Set(args.taskIds);
    tasks = tasks.filter(task => wanted.has(task.id));
    const found = new Set(tasks.map(task => task.id));
    const missing = [...wanted].filter(id => !found.has(id));
    if (missing.length) throw new Error(`Unknown task id(s): ${missing.join(', ')}`);
  }
  if (args.category) tasks = tasks.filter(task => task.category === args.category);
  if (!tasks.length) throw new Error('No benchmark tasks matched the selection.');
  return tasks;
}

function assertSafeTarget(baseUrl, workspacePath) {
  const url = new URL(baseUrl);
  if (!['127.0.0.1', '::1', 'localhost'].includes(url.hostname)) throw new Error('Benchmark runner only connects to a loopback Abyx server.');
  if (url.protocol !== 'http:') throw new Error('Use the local HTTP endpoint for this loopback benchmark run.');

  const realWorkspace = fs.realpathSync(workspacePath);
  const normalizedRoot = path.resolve(ROOT).toLowerCase();
  const normalizedWorkspace = realWorkspace.toLowerCase();
  if (normalizedWorkspace === normalizedRoot || normalizedWorkspace.startsWith(`${normalizedRoot}${path.sep.toLowerCase()}`)) {
    throw new Error('Benchmark workspace must be outside the Abyx checkout.');
  }
  if (!path.basename(realWorkspace).toLowerCase().startsWith('abyx-benchmark-')) {
    throw new Error('Benchmark workspace directory name must start with abyx-benchmark-.');
  }
  return realWorkspace;
}

function pathIsInside(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function copyFixtureTree(sourcePath, destinationPath, fixtureRoot) {
  const lexicalSource = path.resolve(sourcePath);
  if (!pathIsInside(fixtureRoot, lexicalSource)) throw new Error('Fixture path escaped the benchmark dataset root.');
  let componentPath = fixtureRoot;
  for (const component of path.relative(fixtureRoot, lexicalSource).split(path.sep)) {
    componentPath = path.join(componentPath, component);
    if (fs.lstatSync(componentPath).isSymbolicLink()) throw new Error('Symbolic links are not accepted in benchmark fixtures.');
  }
  const resolvedSource = fs.realpathSync(lexicalSource);
  if (!pathIsInside(fixtureRoot, resolvedSource)) throw new Error('Fixture path escaped the benchmark dataset root.');
  const stat = fs.lstatSync(resolvedSource);
  if (stat.isSymbolicLink()) throw new Error('Symbolic links are not accepted in benchmark fixtures.');
  if (stat.isDirectory()) {
    fs.mkdirSync(destinationPath, { recursive: true });
    for (const entry of fs.readdirSync(resolvedSource)) {
      copyFixtureTree(path.join(resolvedSource, entry), path.join(destinationPath, entry), fixtureRoot);
    }
    return;
  }
  if (!stat.isFile()) throw new Error('Benchmark fixture is not a regular file or directory.');
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  if (fs.existsSync(destinationPath)) {
    const expected = crypto.createHash('sha256').update(fs.readFileSync(resolvedSource)).digest('hex');
    const existing = crypto.createHash('sha256').update(fs.readFileSync(destinationPath)).digest('hex');
    if (existing !== expected) throw new Error(`Existing fixture differs from catalog source: ${path.relative(fixtureRoot, lexicalSource)}`);
    return;
  }
  fs.copyFileSync(resolvedSource, destinationPath, fs.constants.COPYFILE_EXCL);
}

function prepareTaskWorkspace(task, workspaceRoot, attemptId) {
  const taskFixtureRoot = path.join(workspaceRoot, 'fixtures', task.id);
  const outputRoot = path.join(workspaceRoot, 'output', task.id, attemptId);
  fs.mkdirSync(taskFixtureRoot, { recursive: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  const datasetRoot = path.realpathSync(path.join(BENCHMARK_ROOT, 'datasets'));
  const copied = [];
  for (const relativeFixture of task.inputFixtures || []) {
    if (typeof relativeFixture !== 'string' || path.isAbsolute(relativeFixture)) throw new Error(`Invalid fixture path in ${task.id}.`);
    const source = path.resolve(datasetRoot, relativeFixture);
    if (!pathIsInside(datasetRoot, source)) throw new Error(`Fixture path escapes dataset root: ${relativeFixture}`);
    const destination = path.resolve(taskFixtureRoot, relativeFixture);
    if (!pathIsInside(taskFixtureRoot, destination)) throw new Error(`Fixture destination escapes task fixture root: ${relativeFixture}`);
    copyFixtureTree(source, destination, datasetRoot);
    const stat = fs.statSync(destination);
    if (stat.isFile()) copied.push({ path: relativeFixture, sha256: crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex') });
    else copied.push({ path: relativeFixture, sha256: null, kind: 'directory' });
  }
  return { fixtureDirectory: path.relative(workspaceRoot, taskFixtureRoot), outputDirectory: path.relative(workspaceRoot, outputRoot), fixtures: copied };
}

async function getJson(baseUrl, pathname) {
  const response = await fetch(new URL(pathname, baseUrl), { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}`);
  return response.json();
}

async function readSse(response, onEvent) {
  if (!response.body) throw new Error('Abyx returned no event stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  let traceBytes = 0;
  let traceTruncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      let type = 'message';
      const dataLines = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) type = line.slice(6).trim();
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      if (!dataLines.length) continue;
      let data;
      try { data = JSON.parse(dataLines.join('\n')); }
      catch { data = { text: dataLines.join('\n') }; }
      if (type === 'token') continue;
      const event = scrub({ type, ...data });
      const eventBytes = Buffer.byteLength(JSON.stringify(event));
      if (traceBytes + eventBytes <= MAX_TRACE_BYTES) {
        events.push(event);
        traceBytes += eventBytes;
        onEvent?.(event);
      } else if (!traceTruncated) {
        events.push({ type: 'trace_truncated', maxTraceBytes: MAX_TRACE_BYTES });
        traceTruncated = true;
      }
    }
  }
  if (buffer.trim()) {
    const dataMatch = buffer.match(/(?:^|\r?\n)data:\s*(.+)/);
    if (dataMatch) {
      let data;
      try { data = JSON.parse(dataMatch[1]); } catch { data = { text: dataMatch[1] }; }
      events.push(scrub({ type: 'message', ...data }));
    }
  }
  return events;
}

async function executeTask(task, { baseUrl, model, workspaceRoot, timeoutMs, signal }) {
  const startedAt = Date.now();
  const sessionId = `bench_${task.id}_${crypto.randomUUID()}`;
  const staged = prepareTaskWorkspace(task, workspaceRoot, sessionId);
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason || new Error('Benchmark cancelled'));
  signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error(`Task exceeded ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetch(new URL('/api/agent/stream', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ task: `${task.prompt}\nThis attempt's unique output directory is ${staged.outputDirectory}.`, model, max_steps: task.maxSteps, sessionId }),
      signal: controller.signal
    });
    if (!response.ok) {
      const message = (await response.text()).slice(0, 1000);
      throw new Error(`Agent endpoint returned HTTP ${response.status}: ${message}`);
    }
    const events = await readSse(response);
    const runDone = [...events].reverse().find(event => event.type === 'run_done');
    const auditEvents = events.filter(event => event.type === 'tool_gateway_audit');
    return {
      taskId: task.id,
      status: runDone?.status || 'incomplete_stream',
      score: null,
      verification: 'manual_review_required',
      stagedFixtures: staged.fixtures,
      outputDirectory: staged.outputDirectory,
      modelRequested: model,
      modelReported: events.find(event => event.model)?.model || runDone?.model || null,
      providerReported: events.find(event => event.provider)?.provider || null,
      sessionId,
      durationMs: Date.now() - startedAt,
      toolCalls: auditEvents.length,
      authorization: auditEvents.map(event => ({ toolId: event.toolId, success: event.success, denied: event.denied, durationMs: event.durationMs })),
      error: runDone?.error || events.find(event => event.type === 'error')?.error || null,
      finalOutput: runDone?.output || null,
      events
    };
  } catch (error) {
    return {
      taskId: task.id,
      status: controller.signal.aborted ? (signal?.aborted ? 'cancelled' : 'timeout') : 'failed',
      score: null,
      verification: 'not_verified',
      stagedFixtures: staged.fixtures,
      outputDirectory: staged.outputDirectory,
      modelRequested: model,
      modelReported: null,
      providerReported: null,
      sessionId,
      durationMs: Date.now() - startedAt,
      toolCalls: 0,
      authorization: [],
      error: scrub(error.message)
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Usage: node benchmarks/runners/run-agent-benchmark.cjs (--task ID[,ID] | --category ID) [--model MODEL] [--dry-run]\nActual runs require a disposable local server/workspace and ABYX_BENCHMARK_DISPOSABLE_OK=1.\n');
    return;
  }
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const tasks = getTasks(catalog, args);
  if (args.list || args.dryRun) {
    process.stdout.write(`${tasks.map(task => `${task.id}\t${task.difficulty}\t${task.categoryName}\t${task.description}`).join('\n')}\n`);
    return;
  }
  if (process.env.ABYX_BENCHMARK_DISPOSABLE_OK !== '1') throw new Error('Set ABYX_BENCHMARK_DISPOSABLE_OK=1 only after starting Abyx with a disposable data directory and workspace.');
  if (!args.model) throw new Error('Specify the exact requested model with --model. This runner does not choose or switch models silently.');
  const workspacePath = process.env.ABYX_BENCHMARK_WORKSPACE;
  if (!workspacePath || !fs.statSync(workspacePath).isDirectory()) throw new Error('ABYX_BENCHMARK_WORKSPACE must point to the active disposable workspace directory.');
  const realWorkspace = assertSafeTarget(process.env.ABYX_BENCHMARK_URL || 'http://127.0.0.1:17642', workspacePath);
  const baseUrl = process.env.ABYX_BENCHMARK_URL || 'http://127.0.0.1:17642';
  const policy = await getJson(baseUrl, '/api/agent/policy');
  const roots = (policy.approvedRoots || []).map(value => path.resolve(value).toLowerCase());
  if (!roots.includes(realWorkspace.toLowerCase())) throw new Error('Abyx server approvedRoots do not exactly match ABYX_BENCHMARK_WORKSPACE; refusing to run.');

  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort(new Error('Interrupted by operator')));
  const prior = fs.existsSync(RESULTS_PATH) ? JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8')) : { schemaVersion: 1, runs: [] };
  const latest = fs.existsSync(LATEST_PATH)
    ? JSON.parse(fs.readFileSync(LATEST_PATH, 'utf8'))
    : { schemaVersion: 1, generatedAt: null, tasks: catalog.map(task => ({ taskId: task.id, category: task.category, difficulty: task.difficulty, status: 'not_run', score: null, verification: 'not_run' })) };
  const run = {
    runId: crypto.randomUUID(), startedAt: new Date().toISOString(),
    environment: { platform: process.platform, arch: process.arch, node: process.version, cpuCount: os.cpus().length, totalMemoryBytes: os.totalmem() },
    endpoint: baseUrl, workspace: realWorkspace, modelRequested: args.model, concurrency: 1,
    tasks: []
  };
  for (const task of tasks) {
    if (controller.signal.aborted) break;
    const result = await executeTask(task, {
      baseUrl, model: args.model, workspaceRoot: realWorkspace,
      timeoutMs: Math.min(task.timeLimitSeconds * 1000, 30 * 60 * 1000),
      signal: controller.signal
    });
    run.tasks.push(result);
    prior.runs.push({ runId: run.runId, taskId: result.taskId, status: result.status, durationMs: result.durationMs, score: null });
    const catalogTask = catalog.find(item => item.id === result.taskId);
    const row = resultRow(result, catalogTask);
    const latestIndex = latest.tasks.findIndex(item => item.taskId === result.taskId);
    if (latestIndex >= 0) latest.tasks[latestIndex] = row;
    else latest.tasks.push(row);
    process.stdout.write(`${result.taskId} ${result.status} ${result.durationMs}ms\n`);
    writeJsonAtomic(RESULTS_PATH, prior);
    latest.generatedAt = new Date().toISOString();
    writeJsonAtomic(LATEST_PATH, latest);
    writeTaskCsv(latest.tasks);
  }
  run.finishedAt = new Date().toISOString();
  run.status = controller.signal.aborted ? 'cancelled' : 'completed';
  const runPath = path.join(BENCHMARK_ROOT, 'results', `${run.runId}.json`);
  writeJsonAtomic(runPath, scrub(run));
  writeJsonAtomic(RESULTS_PATH, prior);
  process.stdout.write(`Saved ${run.tasks.length} task trace(s) to ${path.relative(ROOT, runPath)}\n`);
}

function resultRow(result, task) {
  return {
    taskId: result.taskId, category: task?.category || '', difficulty: task?.difficulty || '', status: result.status,
    score: result.score ?? '', durationMs: result.durationMs, toolCalls: result.toolCalls,
    model: result.modelReported || result.modelRequested, provider: result.providerReported || '',
    verification: result.verification, failureClass: result.error ? 'unknown' : '', error: result.error || ''
  };
}

main().catch(error => {
  process.stderr.write(`${scrub(error.message)}\n`);
  process.exitCode = 1;
});
