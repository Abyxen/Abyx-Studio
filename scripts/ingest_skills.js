/**
 * ABYX Universal Skills & Plugins Ingestion Engine
 * Clones and installs GitHub skills, memory frameworks, agent workflows, and token savers.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const TEMP_CLONE_DIR = path.join(ROOT, 'data', 'temp_skills_clone');

if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
if (!fs.existsSync(TEMP_CLONE_DIR)) fs.mkdirSync(TEMP_CLONE_DIR, { recursive: true });

const REPOS = [
  { url: "https://github.com/worldflowai/everything-claude-code.git", name: "everything-claude-code", category: "Agent Workflow" },
  { url: "https://github.com/cloudflare/security-audit-skill.git", name: "security-audit", category: "Security & Auth" },
  { url: "https://github.com/mattpocock/skills.git", name: "mattpocock-skills", category: "Code Quality" },
  { url: "https://github.com/DietrichGebert/ponytail.git", name: "ponytail", category: "UI & Styling" },
  { url: "https://github.com/pbakaus/impeccable.git", name: "impeccable", category: "UI & Styling" },
  { url: "https://github.com/wheresryan22/anatomy.git", name: "component-anatomy", category: "Code Quality" },
  { url: "https://github.com/nutlope/hallmark.git", name: "hallmark", category: "UI & Styling" },
  { url: "https://github.com/emilkowalski/skills.git", name: "emilkowalski-animations", category: "UI & Styling" },
  { url: "https://github.com/leonxlnx/taste-skill.git", name: "taste-skill", category: "UI & Styling" },
  { url: "https://github.com/morluto/rea.git", name: "rea-code-reasoning", category: "Code Quality" },
  { url: "https://github.com/vercel-labs/agent-skills.git", name: "vercel-agent-skills", category: "Full-Stack & Cloud" },
  { url: "https://github.com/voltagent/awesome-design-md.git", name: "awesome-design-md", category: "UI & Styling" },
  { url: "https://github.com/affaan-m/ECC.git", name: "ecc-workflow", category: "Agent Workflow" },

  // Memory + Context
  { url: "https://github.com/upstash/context7.git", name: "context7-memory", category: "Memory & Context" },
  { url: "https://github.com/thedotmack/claude-mem.git", name: "claude-mem", category: "Memory & Context" },
  { url: "https://github.com/yamadashy/repomix.git", name: "repomix", category: "Memory & Context" },
  { url: "https://github.com/OthmanAdi/planning-with-files.git", name: "planning-with-files", category: "Memory & Context" },
  { url: "https://github.com/gastownhall/beads.git", name: "beads-memory", category: "Memory & Context" },
  { url: "https://github.com/Graphify-Labs/graphify.git", name: "graphify-knowledge-graph", category: "Memory & Context" },

  // Skill Packs
  { url: "https://github.com/obra/superpowers.git", name: "superpowers-agentic", category: "Multi-Agent Teams" },
  { url: "https://github.com/anthropics/skills.git", name: "anthropic-skills", category: "Engineering Craftsmanship" },
  { url: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git", name: "ui-ux-pro-max-extended", category: "UI & Styling" },
  { url: "https://github.com/forrestchang/andrej-karpathy-skills.git", name: "karpathy-skills", category: "Hardware & Local AI" },

  // MCP + Web
  { url: "https://github.com/microsoft/playwright-mcp.git", name: "playwright-mcp-automation", category: "Testing & QA" },
  { url: "https://github.com/oraios/serena.git", name: "serena-research", category: "Research & Web" },
  { url: "https://github.com/firecrawl/firecrawl.git", name: "firecrawl-web-extraction", category: "Research & Web" },
  { url: "https://github.com/github/github-mcp-server.git", name: "github-mcp-workflow", category: "Engineering Craftsmanship" },

  // Agent Workflow
  { url: "https://github.com/musistudio/claude-code-router.git", name: "model-router-workflow", category: "Agent Workflow" },
  { url: "https://github.com/BloopAI/vibe-kanban.git", name: "vibe-kanban", category: "Agent Workflow" },
  { url: "https://github.com/garrytan/gstack.git", name: "gstack-founder-stack", category: "Full-Stack & Cloud" },
  { url: "https://github.com/farion1231/cc-switch.git", name: "cc-switch", category: "Agent Workflow" },
  { url: "https://github.com/jarrodwatts/claude-hud.git", name: "claude-hud", category: "Agent Workflow" },
  { url: "https://github.com/wshobson/agents.git", name: "wshobson-agents", category: "Multi-Agent Teams" },

  // Token Savers
  { url: "https://github.com/headroomlabs-ai/headroom.git", name: "headroom-token-saver", category: "Performance & Tokens" },
  { url: "https://github.com/JuliusBrussee/caveman.git", name: "caveman-compression", category: "Performance & Tokens" },
  { url: "https://github.com/rtk-ai/rtk.git", name: "rtk-token-optimizer", category: "Performance & Tokens" },

  // Lists + Directories
  { url: "https://github.com/anthropics/claude-plugins-official.git", name: "claude-plugins-official", category: "Engineering Craftsmanship" },
  { url: "https://github.com/Piebald-AI/claude-code-system-prompts.git", name: "claude-system-prompts", category: "Agent Workflow" },
  { url: "https://github.com/hesreallyhim/awesome-claude-code.git", name: "awesome-claude-code", category: "Agent Workflow" },
  { url: "https://github.com/punkpeye/awesome-mcp-servers.git", name: "awesome-mcp-reference", category: "Engineering Craftsmanship" },
  { url: "https://github.com/ComposioHQ/awesome-claude-skills.git", name: "awesome-claude-skills", category: "Engineering Craftsmanship" },

  // Vercel Labs
  { url: "https://github.com/vercel-labs/skills.git", name: "vercel-skills-core", category: "Full-Stack & Cloud" },
  { url: "https://github.com/vercel-labs/agent-browser.git", name: "vercel-agent-browser", category: "Research & Web" },
  { url: "https://github.com/vercel-labs/ui.git", name: "vercel-ui-craft", category: "UI & Styling" }
];

function findSkillMdFiles(dir, maxDepth = 4, currentDepth = 0) {
  if (currentDepth > maxDepth || !fs.existsSync(dir)) return [];
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.git')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const potentialSkill = path.join(fullPath, 'SKILL.md');
        if (fs.existsSync(potentialSkill)) {
          results.push({ skillDir: fullPath, skillFile: potentialSkill, name: entry.name });
        } else {
          results.push(...findSkillMdFiles(fullPath, maxDepth, currentDepth + 1));
        }
      }
    }
  } catch (_) {}
  return results;
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.git')) continue;
    const sPath = path.join(src, entry.name);
    const dPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(sPath, dPath);
    } else {
      fs.copyFileSync(sPath, dPath);
    }
  }
}

async function ingest() {
  console.log(`Starting ingestion of ${REPOS.length} requested GitHub skill sources...`);
  let installedCount = 0;

  for (const item of REPOS) {
    const cloneTarget = path.join(TEMP_CLONE_DIR, item.name);
    try {
      console.log(`\n--> [${item.name}] Cloning ${item.url}...`);
      if (fs.existsSync(cloneTarget)) {
        fs.rmSync(cloneTarget, { recursive: true, force: true });
      }

      execSync(`git clone --depth 1 "${item.url}" "${cloneTarget}"`, {
        stdio: 'pipe',
        timeout: 45000
      });

      // 1. Look for explicit SKILL.md directories inside
      const skillMatches = findSkillMdFiles(cloneTarget);
      const rootSkill = path.join(cloneTarget, 'SKILL.md');
      if (fs.existsSync(rootSkill)) {
        skillMatches.unshift({ skillDir: cloneTarget, skillFile: rootSkill, name: item.name });
      }

      if (skillMatches.length > 0) {
        console.log(`    Found ${skillMatches.length} explicit skill(s) in repository!`);
        for (const match of skillMatches) {
          const destName = match.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
          const destPath = path.join(SKILLS_DIR, destName);
          copyDirRecursive(match.skillDir, destPath);
          console.log(`    ✓ Installed skill: "${destName}"`);
          installedCount++;
        }
      } else {
        // 2. Synthesize skill from README.md & repo docs
        console.log(`    Synthesizing operational skill from repo documentation...`);
        let readmeText = '';
        const readmeCandidates = ['README.md', 'readme.md', 'README', 'docs/README.md'];
        for (const c of readmeCandidates) {
          const rPath = path.join(cloneTarget, c);
          if (fs.existsSync(rPath)) {
            readmeText = fs.readFileSync(rPath, 'utf8');
            break;
          }
        }

        if (!readmeText) {
          readmeText = `# ${item.name}\nSpecialized engineering guidelines and tools for ${item.name}.`;
        }

        // Clean text and extract main description
        const cleanBody = readmeText.slice(0, 15000);
        const firstPara = cleanBody.split('\n\n').find(p => p.trim() && !p.startsWith('#')) || `Operational guidelines for ${item.name}`;

        const skillContent = `---
name: ${item.name.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
description: >
  ${firstPara.slice(0, 300).replace(/\r?\n/g, ' ').trim()}
category: ${item.category}
author: GitHub / ${item.url.split('/')[3]}
version: 1.0.0
triggers:
  - "${item.name.replace(/-/g, ' ')}"
  - "${item.name}"
---

# ${item.name.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}

> **Category:** ${item.category}
> **Source Repository:** ${item.url}

## Operational Guidelines & Workflow Instructions

${cleanBody}
`;

        const destPath = path.join(SKILLS_DIR, item.name);
        if (!fs.existsSync(destPath)) fs.mkdirSync(destPath, { recursive: true });
        fs.writeFileSync(path.join(destPath, 'SKILL.md'), skillContent, 'utf8');
        console.log(`    ✓ Synthesized and installed skill: "${item.name}"`);
        installedCount++;
      }

      // Cleanup cloned target to save disk space
      try { fs.rmSync(cloneTarget, { recursive: true, force: true }); } catch (_) {}
    } catch (err) {
      console.warn(`    [WARN] Failed to process ${item.name}: ${err.message}`);
      try { if (fs.existsSync(cloneTarget)) fs.rmSync(cloneTarget, { recursive: true, force: true }); } catch (_) {}
    }
  }

  // Cleanup temp dir
  try { fs.rmSync(TEMP_CLONE_DIR, { recursive: true, force: true }); } catch (_) {}

  console.log(`\n======================================================`);
  console.log(`INGESTION COMPLETE!`);
  console.log(`Total skills processed & installed: ${installedCount}`);
  console.log(`======================================================\n`);
}

ingest().catch(e => console.error('Ingestion fatal error:', e));
