'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

test('Frontend Integration: HarnessService and API Endpoints Contract', async (t) => {
  const root = path.join(__dirname, '..');
  const serverUrl = 'http://127.0.0.1:1420';

  // 1. Specialized Agents API
  await t.test('GET /api/orchestrator/agents returns 15 specialized agents', async () => {
    const res = await fetch(`${serverUrl}/api/orchestrator/agents`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.ok(Array.isArray(data.agents));
    assert.ok(data.agents.length >= 12, `Expected >= 12 agents, got ${data.agents.length}`);
    const roles = data.agents.map(a => a.id || a.role);
    assert.ok(roles.includes('planner'));
    assert.ok(roles.includes('developer'));
    assert.ok(roles.includes('reviewer'));
    assert.ok(roles.includes('tester'));
  });

  // 2. Security & Sandbox API
  await t.test('GET /api/security/status returns isolation tier and approved boundaries', async () => {
    const res = await fetch(`${serverUrl}/api/security/status`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.ok(data.mode === 'build' || data.mode === 'plan');
    assert.ok(data.sandbox);
    assert.ok(data.sandbox.isolationTier);
    assert.ok(Array.isArray(data.approvedRoots));
  });

  await t.test('GET /api/security/workspaces returns active task workspaces and locks', async () => {
    const res = await fetch(`${serverUrl}/api/security/workspaces`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.ok(Array.isArray(data.workspaces));
    assert.ok(Array.isArray(data.activeLocks));
  });

  // 3. Approvals API
  await t.test('GET /api/agent/approvals and POST /api/agent/approve handle human-in-the-loop decisions', async () => {
    const res = await fetch(`${serverUrl}/api/agent/approvals`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.ok(Array.isArray(data.approvals));

    // Test rejection of invalid approval request
    const invalidRes = await fetch(`${serverUrl}/api/agent/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId: 'nonexistent_approval', approved: true })
    });
    const invalidData = await invalidRes.json();
    assert.strictEqual(invalidData.ok, true);
    assert.strictEqual(invalidData.resolved, false);
  });

  // 4. Memory Management API
  await t.test('Memory System: Search, Create, Review, and Delete', async () => {
    // Search
    const searchRes = await fetch(`${serverUrl}/api/agent/memory?level=all`);
    assert.strictEqual(searchRes.status, 200);
    const searchData = await searchRes.json();
    assert.strictEqual(searchData.ok, true);
    assert.ok(Array.isArray(searchData.memories));

    // Create
    const createRes = await fetch(`${serverUrl}/api/agent/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: 'session',
        category: 'test_finding',
        topic: 'Frontend Integration Test',
        content: 'Verification of frontend memory creation endpoint'
      })
    });
    assert.strictEqual(createRes.status, 200);
    const createData = await createRes.json();
    assert.strictEqual(createData.ok, true);
    assert.ok(createData.id);

    // Delete
    const deleteRes = await fetch(`${serverUrl}/api/agent/memory/${encodeURIComponent(createData.id)}?hard=true`, {
      method: 'DELETE'
    });
    assert.strictEqual(deleteRes.status, 200);
    const deleteData = await deleteRes.json();
    assert.strictEqual(deleteData.ok, true);
  });

  // 5. Skills & Tool Bundles API
  await t.test('Skills & Tool Bundles: List and Toggle', async () => {
    const skillsRes = await fetch(`${serverUrl}/api/agent/skills`);
    assert.strictEqual(skillsRes.status, 200);
    const skillsData = await skillsRes.json();
    assert.strictEqual(skillsData.ok, true);
    assert.ok(Array.isArray(skillsData.skills));

    const bundlesRes = await fetch(`${serverUrl}/api/agent/tool-bundles`);
    assert.strictEqual(bundlesRes.status, 200);
    const bundlesData = await bundlesRes.json();
    assert.strictEqual(bundlesData.ok, true);
    assert.ok(Array.isArray(bundlesData.bundles));
    assert.ok(bundlesData.bundles.length >= 4);
  });

  // 6. Terminal Execution API
  await t.test('POST /api/terminal/execute runs controlled command and returns stdout', async () => {
    const res = await fetch(`${serverUrl}/api/terminal/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'node -v',
        cwd: '.'
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.ok(data.stdout || data.output);
    assert.ok((data.stdout || data.output).includes('v'));
  });

  // 7. File Diff Inspection API
  await t.test('POST /api/files/diff computes line-by-line diff', async () => {
    const res = await fetch(`${serverUrl}/api/files/diff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalContent: 'line 1\nline 2\nline 3\n',
        newContent: 'line 1\nmodified line 2\nline 3\nadded line 4\n'
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.ok(data.additions >= 2);
    assert.ok(data.deletions >= 1);
    assert.ok(Array.isArray(data.diffLines));
  });

  // 8. Verification & Benchmarks API
  await t.test('Verification & Benchmarks: Verify, Review, and Benchmark Tasks', async () => {
    // Verification
    const verifyRes = await fetch(`${serverUrl}/api/verification/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: ['package.json'],
        assertions: [{ file: 'package.json', nonZeroSize: true }]
      })
    });
    assert.strictEqual(verifyRes.status, 200);
    const verifyData = await verifyRes.json();
    assert.strictEqual(verifyData.ok, true);

    // Benchmarks
    const benchRes = await fetch(`${serverUrl}/api/benchmark/tasks`);
    assert.strictEqual(benchRes.status, 200);
    const benchData = await benchRes.json();
    assert.strictEqual(benchData.ok, true);
    assert.strictEqual(benchData.tasks.length, 12);
  });

  // 9. Multi-Agent Swarm SSE Stream Execution
  await t.test('POST /api/orchestrator/run streams live SSE events', async () => {
    const res = await fetch(`${serverUrl}/api/orchestrator/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: 'In 1 concise sentence describe the Abyx architecture.',
        model: 'AbyxV2 9B.gguf',
        concurrency: 2
      })
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('text/event-stream'));

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let receivedEvents = [];
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const chunk = buffer.substring(0, boundary);
        buffer = buffer.substring(boundary + 2);
        for (const line of chunk.split('\n')) {
          if (line.startsWith('event:')) {
            receivedEvents.push(line.replace('event:', '').trim());
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }

    assert.ok(receivedEvents.length >= 2, `Expected >= 2 SSE events, received: ${receivedEvents.join(', ')}`);
    assert.ok(receivedEvents.includes('orchestration:start'));
    assert.ok(receivedEvents.includes('orchestration:done'));
  });
});
