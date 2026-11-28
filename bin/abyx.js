#!/usr/bin/env node
'use strict';

/**
 * ABYX Unified CLI & Gateway Runner
 * Primary command line entry point for the canonical ABYX Unified AI Studio.
 */

const path = require('node:path');
const { ApiGateway } = require('../services/api_gateway');
const { createAgentEngine } = require('../agent/index');

const command = process.argv[2] || 'start';

async function main() {
  if (command === 'start' || command === 'server') {
    const port = process.env.PORT || 3000;
    const gateway = new ApiGateway({ port: Number(port) });
    const { url } = await gateway.start();

    console.log('====================================================');
    console.log('       ABYX UNIFIED AI STUDIO - CANONICAL GATEWAY    ');
    console.log('====================================================');
    console.log(`[ABYX] API Server running at:       ${url}`);
    console.log(`[ABYX] Health Endpoint:             ${url}/api/health`);
    console.log(`[ABYX] Tools Catalog:               ${url}/api/tools`);
    console.log(`[ABYX] SSE Event Stream:            ${url}/api/events/stream`);
    console.log(`[ABYX] WebSocket Server:            ws://localhost:3001`);
    console.log('====================================================');
    console.log('Press Ctrl+C to stop.\n');

    process.on('SIGINT', async () => {
      console.log('\n[ABYX] Shutting down gateway...');
      await gateway.stop();
      process.exit(0);
    });

  } else if (command === 'run') {
    const prompt = process.argv.slice(3).join(' ') || 'Inspect repository and list status';
    console.log('====================================================');
    console.log('       ABYX AUTONOMOUS AGENT RUNTIME                ');
    console.log('====================================================');
    console.log(`[ABYX] Task Prompt: "${prompt}"`);
    console.log(`[ABYX] Initializing unified agent engine...\n`);

    const engine = createAgentEngine({ workspaceRoot: process.cwd() });
    
    console.log(`[ABYX] Registered Tools: ${engine.toolRegistry.tools.size} tools ready.`);
    console.log(`[ABYX] Starting autonomous execution loop...\n`);

    const runResult = await engine.engine.run({
      goal: prompt,
      maxSteps: 10,
      onEvent: (type, data) => {
        if (type === 'step:start') {
          console.log(`\n---> [Step ${data.step}/${data.maxSteps}] Reasoning & Tool Selection...`);
        } else if (type === 'tool:call') {
          console.log(`[ABYX Tool Call]: ${data.tool}(${JSON.stringify(data.args)})`);
        } else if (type === 'tool:result') {
          console.log(`[ABYX Tool Result]: ${JSON.stringify(data.result).slice(0, 150)}...`);
        } else if (type === 'step:answer') {
          console.log(`\n[ABYX Agent Response]:\n${data.content}`);
        }
      }
    });

    console.log('\n====================================================');
    console.log(`[ABYX] Execution finished: ${runResult.status} (Steps: ${runResult.stepCount})`);
    console.log('====================================================');
    process.exit(runResult.ok ? 0 : 1);

  } else if (command === 'init' || command === '/init') {
    const fs = require('node:fs');
    const agentsPath = path.join(process.cwd(), 'AGENTS.md');
    console.log('====================================================');
    console.log('       ABYX WORKSPACE INITIALIZATION (/init)        ');
    console.log('====================================================');
    if (fs.existsSync(agentsPath)) {
      console.log(`[ABYX /init] AGENTS.md already exists at: ${agentsPath}`);
    } else {
      console.log(`[ABYX /init] Creating default AGENTS.md rulebook...`);
      const defaultAgentsMd = `# AGENTS.md — Project Operational Rules\n\n## 1. General Security\n- Strictly respect workspace boundaries.\n- Deny destructive operations in Plan Mode.\n\n## 2. Architecture\n- Consult docs/architecture/UNIFIED_ARCHITECTURE.md for canonical guidelines.\n`;
      fs.writeFileSync(agentsPath, defaultAgentsMd, 'utf8');
      console.log(`[ABYX /init] Successfully created AGENTS.md.`);
    }
    console.log(`[ABYX /init] Workspace ready for autonomous agent execution.\n`);
    process.exit(0);

  } else if (command === 'goal' || command === '/goal') {
    const prompt = process.argv.slice(3).join(' ') || 'Autonomous goal execution';
    console.log(`[ABYX /goal] Launching Goal Orchestrator for: "${prompt}"`);
    const { GoalOrchestrator } = require('../agent/goal_orchestrator');
    const orchestrator = new GoalOrchestrator(process.cwd());
    const res = await orchestrator.executeGoal(prompt);
    console.log(`[ABYX /goal] Result:`, res.achieved ? 'ACHIEVED' : 'INCOMPLETE', `(Iterations: ${res.iterations})`);
    process.exit(res.achieved ? 0 : 1);

  } else if (command === 'help' || command === '--help' || command === '-h') {
    console.log('Usage:');
    console.log('  node bin/abyx.js start        Start the unified API & WebSocket gateway');
    console.log('  node bin/abyx.js init         Initialize workspace and generate AGENTS.md (/init)');
    console.log('  node bin/abyx.js run "<task>" Run an autonomous model-driven agent task');
    console.log('  node bin/abyx.js goal "<g>"   Run autonomous goal loop (/goal)');
    console.log('  npm test                      Run complete automated test suite');
  } else {
    console.log(`Unknown command: "${command}". Run "node bin/abyx.js help" for usage.`);
  }
}

main().catch(err => {
  console.error('[ABYX Fatal Error]:', err.message);
  process.exit(1);
});
