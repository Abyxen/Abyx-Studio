'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Phase 3: Workspaces, Projects, and Boundary Enforcement', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abyx-test-ws-'));
  const testWorkspaceBase = path.join(tempDir, 'workspace_store');
  const testProjectA = path.join(tempDir, 'project_alpha');
  const testProjectB = path.join(tempDir, 'project_beta');
  const outsideDir = path.join(tempDir, 'outside_forbidden');

  fs.mkdirSync(testWorkspaceBase, { recursive: true });
  fs.mkdirSync(testProjectA, { recursive: true });
  fs.mkdirSync(testProjectB, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });

  fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'SUPER_SECRET_OUTSIDE');

  process.env.ABYX_WORKSPACE_DIR = testWorkspaceBase;

  // Clear require cache to ensure clean initialization with isolated ABYX_WORKSPACE_DIR
  delete require.cache[require.resolve('../../data_paths')];
  delete require.cache[require.resolve('../../services/workspace_service')];
  delete require.cache[require.resolve('../../agent/path_guard')];
  delete require.cache[require.resolve('../../agent/tools/fs_tool')];

  const PathGuard = require('../../agent/path_guard');
  const WorkspaceFsTool = require('../../agent/tools/fs_tool');
  const workspaceService = require('../../services/workspace_service');

  t.after(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
    delete process.env.ABYX_WORKSPACE_DIR;
    delete require.cache[require.resolve('../../data_paths')];
    delete require.cache[require.resolve('../../services/workspace_service')];
  });

  await t.test('1. Project creation with existing and auto-created folder', () => {
    // Existing folder
    const wsA = workspaceService.createWorkspace('Alpha Project', testProjectA);
    assert.ok(wsA.id);
    assert.equal(wsA.name, 'Alpha Project');
    assert.equal(fs.realpathSync(wsA.path), fs.realpathSync(testProjectA));
    assert.equal(workspaceService.getActiveWorkspace()?.id, wsA.id);

    // Auto-created folder
    const autoCreatedFolder = path.join(tempDir, 'auto_created_sub');
    assert.equal(fs.existsSync(autoCreatedFolder), false);
    const wsAuto = workspaceService.createWorkspace('Auto Created', autoCreatedFolder);
    assert.equal(fs.existsSync(autoCreatedFolder), true);
    assert.equal(workspaceService.getActiveWorkspace()?.id, wsAuto.id);

    // Duplicate rejection
    assert.throws(() => {
      workspaceService.createWorkspace('Duplicate Path', testProjectA);
    }, /already assigned/i);
  });

  await t.test('2. Project switching and safe handling of missing folders', () => {
    const list = workspaceService.getWorkspaces();
    const wsA = list.find(w => w.name === 'Alpha Project');
    assert.ok(wsA);

    // Switch active project
    const switched = workspaceService.setActiveWorkspace(wsA.id);
    assert.equal(switched, true);
    assert.equal(workspaceService.getActiveWorkspace()?.id, wsA.id);

    // Missing folder handling
    const ghostDir = path.join(tempDir, 'ghost_dir');
    fs.mkdirSync(ghostDir, { recursive: true });
    const wsGhost = workspaceService.createWorkspace('Ghost Project', ghostDir);
    assert.equal(workspaceService.getActiveWorkspace()?.id, wsGhost.id);

    // Delete folder from disk outside the app
    fs.rmSync(ghostDir, { recursive: true, force: true });

    // Ensure list reports available: false
    const updatedList = workspaceService.getWorkspaces();
    const ghostReport = updatedList.find(w => w.id === wsGhost.id);
    assert.equal(ghostReport?.available, false);

    // Switch to missing folder must fail safely
    const switchResult = workspaceService.setActiveWorkspace(wsGhost.id);
    assert.equal(switchResult, false);

    // Clean up ghost project
    workspaceService.deleteWorkspace(wsGhost.id);
    workspaceService.setActiveWorkspace(wsA.id);
  });

  await t.test('3. Strict Workspace Boundary & Security Enforcement (PathGuard)', () => {
    const guard = new PathGuard([testProjectA]);

    // Valid path inside workspace
    const safePath = guard.resolveSafePath('src/main.js', { allowCreate: true });
    assert.ok(safePath.toLowerCase().startsWith(path.normalize(testProjectA).toLowerCase()));

    // Traversal attempts must throw Security Violation
    assert.throws(() => {
      guard.resolveSafePath('../outside_forbidden/secret.txt');
    }, /traverses outside approved workspace boundaries/i);

    assert.throws(() => {
      guard.resolveSafePath('..\\outside_forbidden\\secret.txt');
    }, /traverses outside approved workspace boundaries/i);

    assert.throws(() => {
      guard.resolveSafePath(path.join(outsideDir, 'secret.txt'));
    }, /traverses outside approved workspace boundaries/i);

    // Null byte injection must throw Security Violation
    assert.throws(() => {
      guard.resolveSafePath('test\0payload.txt');
    }, /null byte/i);

    // Secret pattern (.env, credentials, abyx_memory.db) must throw Security Violation
    assert.throws(() => {
      guard.resolveSafePath('.env', { allowCreate: true });
    }, /sensitive file or directory is blocked/i);

    assert.throws(() => {
      guard.resolveSafePath('credentials.json', { allowCreate: true });
    }, /sensitive file or directory is blocked/i);

    assert.throws(() => {
      guard.resolveSafePath('abyx_memory.db', { allowCreate: true });
    }, /sensitive file or directory is blocked/i);
  });

  await t.test('4. WorkspaceFsTool operations strictly contained to active project', async () => {
    const guard = new PathGuard([testProjectA]);
    const fsTool = new WorkspaceFsTool(guard);

    // 1. Write file
    const writeRes = await fsTool.write({
      filePath: 'hello.txt',
      content: 'Hello ABYX Workspace!'
    });
    assert.equal(writeRes.success, true);
    assert.equal(fs.existsSync(path.join(testProjectA, 'hello.txt')), true);

    // 2. Read file
    const readRes = await fsTool.read({ filePath: 'hello.txt' });
    assert.equal(readRes.success, true);
    assert.equal(readRes.content, 'Hello ABYX Workspace!');

    // 3. Edit file (surgical find & replace)
    const editRes = await fsTool.edit({
      filePath: 'hello.txt',
      target: 'ABYX Workspace',
      replacement: 'Unified Studio'
    });
    assert.equal(editRes.success, true);
    const readAfterEdit = await fsTool.read({ filePath: 'hello.txt' });
    assert.equal(readAfterEdit.content, 'Hello Unified Studio!');

    // 4. Search files by name & content
    const searchName = await fsTool.search({ query: 'hello' });
    assert.equal(searchName.success, true);
    assert.ok(searchName.matches.length >= 1);

    const searchContent = await fsTool.search({ query: 'Unified Studio' });
    assert.equal(searchContent.success, true);
    assert.ok(searchContent.matches.some(m => m.matchType === 'content'));

    // 5. List files
    const listRes = await fsTool.list({ dirPath: '.' });
    assert.equal(listRes.success, true);
    assert.ok(listRes.entries.some(e => e.name === 'hello.txt'));

    // 6. Delete file
    const delRes = await fsTool.delete({ filePath: 'hello.txt' });
    assert.equal(delRes.success, true);
    assert.equal(fs.existsSync(path.join(testProjectA, 'hello.txt')), false);

    // 7. Verify write outside workspace is blocked
    await assert.rejects(async () => {
      await fsTool.write({
        filePath: '../outside_forbidden/hacked.txt',
        content: 'pwned'
      });
    }, /traverses outside approved workspace boundaries/i);
  });
});
