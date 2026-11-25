'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { verify } = require('./verify-fixtures.cjs');

const benchmarkRoot = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(benchmarkRoot, 'tasks', 'catalog.json'), 'utf8'));

test('task catalog meets distinct task counts, difficulty quotas, and rubric total', () => {
  assert.equal(catalog.length, 275);
  assert.equal(new Set(catalog.map(task => task.id)).size, 275);
  assert.deepEqual(
    Object.fromEntries(['basic', 'intermediate', 'advanced', 'end_to_end'].map(level => [level, catalog.filter(task => task.difficulty === level).length])),
    { basic: 100, intermediate: 100, advanced: 50, end_to_end: 25 }
  );
  for (const task of catalog) {
    assert.ok(task.id && task.description && task.prompt && task.expectedOutput && task.verification);
    assert.equal(Object.values(task.scoreWeights).reduce((sum, weight) => sum + weight, 0), 100, task.id);
  }
});

test('catalog fixture paths exist inside the benchmark dataset root', () => {
  const datasetRoot = path.resolve(benchmarkRoot, 'datasets');
  for (const task of catalog) for (const fixture of task.inputFixtures) {
    assert.equal(path.isAbsolute(fixture), false, `${task.id}: absolute fixture path`);
    const resolved = path.resolve(datasetRoot, fixture);
    const relative = path.relative(datasetRoot, resolved);
    assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`), `${task.id}: fixture escapes dataset`);
    assert.ok(fs.existsSync(resolved), `${task.id}: fixture missing ${fixture}`);
  }
});

test('synthetic CSV, JSON, XML and fixture hashes match the independent oracle', () => {
  const result = verify();
  assert.equal(result.ok, true, JSON.stringify(result.failures));
});

test('repository fixture begins with the intended failing assertions', () => {
  const project = path.join(benchmarkRoot, 'datasets', 'repositories', 'mini-repo');
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test'], { cwd: project, env: childEnv, encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /tests 3/);
  assert.match(result.stdout, /fail 2/);
});

test('runner only targets disposable local endpoints and requires explicit model identity', () => {
  const script = path.join(benchmarkRoot, 'runners', 'run-agent-benchmark.cjs');
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /disposable local server\/workspace/);
  const dryRun = spawnSync(process.execPath, [script, '--task', catalog[0].id, '--dry-run'], { cwd: path.resolve(benchmarkRoot, '..'), encoding: 'utf8', timeout: 5000, windowsHide: true });
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, new RegExp(catalog[0].id));
});
