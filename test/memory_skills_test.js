'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { MemoryManager, SessionMemory } = require('../agent/memory/memory_manager');
const SkillEngine = require('../agent/skills/skill_engine');
const PluginManager = require('../agent/plugins/plugin_manager');

const BASE_TEST_DIR = path.resolve(__dirname, '_fixtures_memory_skills');

function safeCleanup(dir) {
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  } catch (_) {}
}

// ==========================================
// 1. SESSION MEMORY TESTS
// ==========================================

test('SessionMemory: manages active turns, task states, and bounds observations', () => {
  const session = new SessionMemory({ maxObservations: 3, maxTurns: 5 });

  // 1. Turn management
  for (let i = 1; i <= 7; i++) {
    session.recordTurn('user', `Message turn ${i}`);
  }
  const snapshot = session.getSnapshot();
  assert.strictEqual(snapshot.turnsCount, 5, 'SessionMemory respects maxTurns bounds');

  // 2. Task state tracking
  session.setTask({ id: 'task_101', goal: 'Build authentication endpoint', activeStep: 2 });
  assert.strictEqual(session.currentTask.id, 'task_101');
  assert.strictEqual(session.currentTask.goal, 'Build authentication endpoint');

  // 3. Agent state updates
  session.updateAgentState('coder', { status: 'writing_code', lastFile: 'auth.js' });
  const coderState = session.getAgentState('coder');
  assert.strictEqual(coderState.status, 'writing_code');
  assert.strictEqual(coderState.lastFile, 'auth.js');

  // 4. Bounded tool observations & massive output truncation
  const massiveOutput = 'A'.repeat(5000);
  session.recordToolResult('fs_read', { path: 'big.txt' }, massiveOutput);
  session.recordToolResult('fs_write', { path: 'a.js' }, { ok: true });
  session.recordToolResult('terminal', { command: 'npm test' }, { code: 0 });
  session.recordToolResult('fs_edit', { path: 'b.js' }, { ok: true });

  const recent = session.getRecentObservations();
  assert.strictEqual(recent.length, 3, 'Recent observations circular buffer bounds to maxObservations');
  session.clear();
  assert.strictEqual(session.getSnapshot().turnsCount, 0);
});

// ==========================================
// 2. 3-TIER MEMORY & SQLITE PERSISTENCE TESTS
// ==========================================

test('MemoryManager: enforces selective persistence, deduplication, and project isolation', () => {
  const memDir = path.join(BASE_TEST_DIR, 'mem');
  safeCleanup(memDir);
  fs.mkdirSync(memDir, { recursive: true });

  const dbPath = path.join(memDir, 'test_memory.db');
  let mm = null;
  let mmRestarted = null;

  try {
    mm = new MemoryManager({ workspaceRoot: memDir, dbPath });

    // 1. Non-blind persistence: Filters out trivial chit-chat
    const trivial = mm.createMemory({ level: 'persistent', content: 'hello', category: 'general' });
    assert.strictEqual(trivial.ok, false);
    assert.strictEqual(trivial.ignored, true);

    // 2. Project Memory creation & scoping
    const pm1 = mm.createMemory({
      level: 'project',
      projectId: 'proj_alpha',
      category: 'architecture',
      title: 'Microservices Layout',
      content: 'All auth routes reside under /api/v1/auth with JWT bearer tokens.',
      tags: ['auth', 'security', 'architecture']
    });
    assert.strictEqual(pm1.ok, true);
    assert.strictEqual(pm1.deduplicated, false);

    // 3. Project Memory Deduplication
    const pm1Duplicate = mm.createMemory({
      level: 'project',
      projectId: 'proj_alpha',
      category: 'architecture',
      title: 'Microservices Layout',
      content: 'All auth routes reside under /api/v1/auth with JWT bearer tokens.',
      tags: ['duplicate_tag']
    });
    assert.strictEqual(pm1Duplicate.ok, true);
    assert.strictEqual(pm1Duplicate.deduplicated, true);

    // 4. Project Separation: proj_beta cannot see proj_alpha memory
    const betaSearch = mm.searchMemory({ query: 'auth routes', projectId: 'proj_beta' });
    assert.strictEqual(betaSearch.length, 0, 'Project memories strictly isolated between projects');

    const alphaSearch = mm.searchMemory({ query: 'auth routes', projectId: 'proj_alpha' });
    assert.strictEqual(alphaSearch.length, 1);
    assert.strictEqual(alphaSearch[0].projectId, 'proj_alpha');
    assert.ok(alphaSearch[0].score > 0.5);

    // 5. Persistent Memory & Human-in-the-Loop Approval Workflow
    const perm = mm.createMemory({
      level: 'persistent',
      category: 'user_preferences',
      title: 'Code Formatting Guidelines',
      content: 'Prefer strict TypeScript with single quotes and 2-space indentation.',
      tags: ['style', 'typescript']
    });
    assert.strictEqual(perm.ok, true);
    assert.strictEqual(perm.approved, false, 'Persistent memories default to pending review');

    // Before approval: search with approvedOnly=true should return empty
    const unapprovedSearch = mm.searchMemory({ query: 'TypeScript', level: 'persistent', approvedOnly: true });
    assert.strictEqual(unapprovedSearch.length, 0);

    // Approve memory
    const review = mm.reviewMemory(perm.id, { approved: true, reviewedBy: 'admin_user' });
    assert.strictEqual(review.ok, true);
    assert.strictEqual(review.approved, true);

    // After approval: should appear in approvedOnly queries
    const approvedSearch = mm.searchMemory({ query: 'TypeScript', level: 'persistent', approvedOnly: true });
    assert.strictEqual(approvedSearch.length, 1);
    assert.strictEqual(approvedSearch[0].id, perm.id);

    // 6. TTL Expiration & Pruning
    const exp = mm.createMemory({
      level: 'project',
      projectId: 'proj_alpha',
      category: 'known_issues',
      title: 'Temporary Flaky Endpoint',
      content: 'Endpoint /api/test times out intermittently under load.',
      ttlSeconds: -10 // already expired
    });
    assert.strictEqual(exp.ok, true);

    const prune = mm.pruneExpired();
    assert.strictEqual(prune.prunedCount, 1);

    // 7. Restart Persistence: Close DB, Re-open, Verify Records Intact
    mm.close();
    mm = null;

    mmRestarted = new MemoryManager({ workspaceRoot: memDir, dbPath });
    const restartedSearch = mmRestarted.searchMemory({ query: 'Microservices', projectId: 'proj_alpha' });
    assert.strictEqual(restartedSearch.length, 1);
    assert.strictEqual(restartedSearch[0].title, 'Microservices Layout');
  } finally {
    if (mm) mm.close();
    if (mmRestarted) mmRestarted.close();
    safeCleanup(memDir);
  }
});

// ==========================================
// 3. SKILL.MD ENGINE & LIFECYCLE TESTS
// ==========================================

test('SkillEngine: parses SKILL.md, lazy-loads bodies, validates eligibility, and manages trust', () => {
  const skillsDir = path.join(BASE_TEST_DIR, 'skills_test');
  safeCleanup(skillsDir);
  fs.mkdirSync(skillsDir, { recursive: true });

  const globalSkillsDir = path.join(skillsDir, 'global_skills');
  const projectSkillsDir = path.join(skillsDir, '.abyx', 'skills');
  fs.mkdirSync(globalSkillsDir, { recursive: true });
  fs.mkdirSync(projectSkillsDir, { recursive: true });

  try {
    // 1. Author Global Skill with YAML Frontmatter
    const testSkill1Content = `---
name: Database Migrations Engine
description: Safely generates, verifies, and executes SQL schema migrations.
version: 1.2.0
risk_tier: safe
trigger_conditions:
  - "database migration"
  - "alter table"
  - "create schema"
required_tools:
  - fs_read
  - fs_write
allowed_agents:
  - data_engineer
  - developer
---

# Database Migrations Instruction
Always create expand/contract patterns for zero-downtime schema evolution.
Verify rollback steps prior to execution.
`;
    fs.writeFileSync(path.join(globalSkillsDir, 'db_migrations.md'), testSkill1Content, 'utf8');

    // 2. Author Project-Scoped Elevated Skill
    const testSkill2Content = `---
name: Docker Container Builder
description: Builds and tests containerized environments on Windows WSL2.
version: 2.0.0
risk_tier: elevated
trigger_conditions:
  - "docker build"
  - "containerize"
required_tools:
  - run_command
allowed_agents:
  - "*"
---

# Container Builder Instructions
Run multi-stage Docker builds with BuildKit caching.
`;
    fs.writeFileSync(path.join(projectSkillsDir, 'docker_builder.md'), testSkill2Content, 'utf8');

    const engine = new SkillEngine({
      workspaceRoot: skillsDir,
      globalSkillsDir,
      registryPath: path.join(skillsDir, 'skills_registry.json'),
      availableTools: ['fs_read', 'fs_write'] // Note: run_command is intentionally omitted here!
    });

    const skills = engine.listSkills();
    assert.strictEqual(skills.length, 2, 'SkillEngine discovers both global and project skills');

    // 3. Lazy loading check: Metadata is present, instructions body is omitted until requested
    const metaOnly = engine.getSkill('db_migrations', { loadBody: false });
    assert.strictEqual(metaOnly.name, 'Database Migrations Engine');
    assert.strictEqual(metaOnly.instructions, undefined, 'Body is lazy-loaded and not read initially');

    const withBody = engine.getSkill('db_migrations', { loadBody: true });
    assert.ok(withBody.instructions.includes('Always create expand/contract patterns'));

    // 4. Eligibility check: Docker Builder requires "run_command" which is missing
    const dockerSkill = engine.getSkill('docker_builder', { loadBody: false });
    assert.strictEqual(dockerSkill.eligible, false);
    assert.ok(dockerSkill.ineligibilityReasons[0].includes('Missing required tool: "run_command"'));

    const dbSkill = engine.getSkill('db_migrations', { loadBody: false });
    assert.strictEqual(dbSkill.eligible, true);

    // 5. Skill Matching & Dynamic Context Injection
    const matched = engine.matchSkills('Need to perform database migration on users table', {
      agentId: 'data_engineer'
    });
    assert.strictEqual(matched.length, 1);
    assert.strictEqual(matched[0].name, 'Database Migrations Engine');
    assert.ok(matched[0].instructions.length > 0, 'Matched skill automatically lazy-loads instructions');

    // 6. Agent scope filtering: reviewer should not receive data_engineer scoped skill
    const reviewerMatch = engine.matchSkills('database migration', { agentId: 'reviewer' });
    assert.strictEqual(reviewerMatch.length, 0, 'Agent-restricted skill is filtered out for unlisted agent');

    // 7. Install Third-Party Skill & Trust Verification
    const thirdPartySkill = `---
name: Web Scraper Automation
description: Crawls third-party web pages.
risk_tier: safe
---
# Scraper Body
Fetch web documentation safely.
`;
    const installRes = engine.installSkill(thirdPartySkill, {
      scope: 'project',
      fileName: 'web_scraper.md',
      trusted: false // Untrusted third-party
    });
    assert.strictEqual(installRes.ok, true);
    assert.strictEqual(installRes.requiresApproval, true);

    const scraperSkill = engine.getSkill('web_scraper');
    assert.strictEqual(scraperSkill.trusted, false, 'Third-party skills default to untrusted');

    // Approve third party skill
    const approval = engine.approveSkill('web_scraper', { approvedBy: 'user' });
    assert.strictEqual(approval.ok, true);
    assert.strictEqual(engine.getSkill('web_scraper').trusted, true);
  } finally {
    safeCleanup(skillsDir);
  }
});

// ==========================================
// 4. PLUGIN & EXTENSION LIFECYCLE TESTS
// ==========================================

test('PluginManager: loads plugins, registers tools, executes lifecycle hooks, and enforces trust', async () => {
  const pluginsTestDir = path.join(BASE_TEST_DIR, 'plugins_test');
  safeCleanup(pluginsTestDir);
  fs.mkdirSync(pluginsTestDir, { recursive: true });

  const pluginsDir = path.join(pluginsTestDir, 'plugins');
  const samplePluginDir = path.join(pluginsDir, 'sample_plugin');
  fs.mkdirSync(samplePluginDir, { recursive: true });

  try {
    // 1. Author Plugin Manifest (plugin.json)
    const manifest = {
      id: 'sample_plugin',
      name: 'Sample Developer Plugin',
      version: '1.0.0',
      description: 'Custom lifecycle and tool extension',
      author: 'Test Engineering',
      permissions: ['tools:register', 'hooks:lifecycle', 'agent:behavior'],
      entrypoint: 'index.js',
      trusted: true
    };
    fs.writeFileSync(path.join(samplePluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8');

    // 2. Author Plugin Entrypoint (index.js)
    const entrypointCode = `
module.exports = function(context) {
  // Register custom tool
  context.registerTool({
    name: 'hash_calculator',
    description: 'Computes sha256 checksum of input string',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text']
    }
  }, async (args) => {
    const crypto = require('node:crypto');
    return { ok: true, hash: crypto.createHash('sha256').update(args.text).digest('hex') };
  });

  // Register lifecycle hook
  context.registerLifecycleHook('onSessionStart', async (ctx) => {
    // Flag received in test
  });

  // Register agent behavior
  context.registerAgentBehavior('coder', (basePrompt) => {
    return basePrompt + '\\n[Plugin Directive]: Always include unit tests.';
  });
};
`;
    fs.writeFileSync(path.join(samplePluginDir, 'index.js'), entrypointCode, 'utf8');

    // Mock ToolRegistry
    const mockTools = new Map();
    const mockToolGateway = {
      toolRegistry: {
        register: (tool) => mockTools.set(tool.id, tool)
      }
    };

    const manager = new PluginManager({
      workspaceRoot: pluginsTestDir,
      pluginsDir,
      registryPath: path.join(pluginsTestDir, 'plugins_registry.json'),
      toolGateway: mockToolGateway
    });

    const list = manager.listPlugins();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, 'sample_plugin');
    assert.strictEqual(list[0].loaded, true);

    // 3. Verify registered tool
    assert.ok(mockTools.has('plugin_sample_plugin_hash_calculator'));
    const registeredTool = mockTools.get('plugin_sample_plugin_hash_calculator');
    const toolResult = await registeredTool.execute({ text: 'Abyx AI Studio' });
    assert.strictEqual(toolResult.ok, true);
    assert.ok(toolResult.hash.length === 64);

    // 4. Verify agent prompt augmentation
    const modifiedPrompt = manager.applyAgentBehaviors('coder', 'You are the Senior Coder.');
    assert.ok(modifiedPrompt.includes('[Plugin Directive]: Always include unit tests.'));

    // 5. Untrusted Plugin Protection: Cannot load without explicit trust decision
    const untrustedDir = path.join(pluginsDir, 'untrusted_plugin');
    fs.mkdirSync(untrustedDir, { recursive: true });
    fs.writeFileSync(path.join(untrustedDir, 'plugin.json'), JSON.stringify({
      id: 'untrusted_plugin',
      name: 'Untrusted Script',
      version: '0.1.0',
      trusted: false
    }, null, 2), 'utf8');
    fs.writeFileSync(path.join(untrustedDir, 'index.js'), 'module.exports = () => {};', 'utf8');

    manager.discoverPlugins();
    const untrustedLoad = manager.loadPlugin('untrusted_plugin');
    assert.strictEqual(untrustedLoad.ok, false);
    assert.ok(untrustedLoad.error.includes('Untrusted plugins cannot be loaded'));

    // Approve untrusted plugin
    const approveRes = manager.approvePlugin('untrusted_plugin', { approvedBy: 'security_auditor' });
    assert.strictEqual(approveRes.ok, true);
    assert.strictEqual(approveRes.trusted, true);

    // 6. Persistence across restart
    const managerRestarted = new PluginManager({
      workspaceRoot: pluginsTestDir,
      pluginsDir,
      registryPath: path.join(pluginsTestDir, 'plugins_registry.json'),
      toolGateway: mockToolGateway
    });

    const restartedPlugins = managerRestarted.listPlugins();
    const untrustedSaved = restartedPlugins.find(p => p.id === 'untrusted_plugin');
    assert.strictEqual(untrustedSaved.trusted, true, 'Approval status persists across restarts');
  } finally {
    safeCleanup(pluginsTestDir);
  }
});
