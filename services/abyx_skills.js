/**
 * ABYX Universal Skills & Plugin Hub
 * Integrates industry-grade skills from AMD, Shokunin, Wshobson Agents, and Agentic-Awesome-Skills.
 * Enables local neural runtimes and cloud models to dynamically consult and execute specialized skills.
 */

const fs = require('fs');
const path = require('path');
const { dataDir } = require('../data_paths');

const SKILLS_DIR = path.resolve(__dirname, '..', 'skills');
const INSTALLED_SKILLS_DIR = path.resolve(__dirname, '..', 'data', 'extensions', 'installed', 'skills');

const profileSkillIndexes = new Map();

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const rawMeta = match[1];
  const body = match[2].trim();
  const meta = {};

  for (const line of rawMeta.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx !== -1) {
      const key = trimmed.slice(0, colonIdx).trim();
      let val = trimmed.slice(colonIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      meta[key] = val;
    }
  }

  return { meta, body };
}

function indexSkills(force = false, profileId = 'prof_default') {
  const now = Date.now();
  const pid = String(profileId || 'prof_default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cached = profileSkillIndexes.get(pid);
  if (!force && cached && now - cached.indexedAt < 300000) {
    return Array.from(cached.skills.values());
  }

  const indexedSkills = new Map();

  const profileInstalledDir = path.join(dataDir, 'profiles', pid, 'extensions', 'installed', 'skills');
  const scanDirs = [SKILLS_DIR, profileInstalledDir];
  if (pid === 'prof_default') scanDirs.push(INSTALLED_SKILLS_DIR);
  for (const sDir of scanDirs) {
    if (!fs.existsSync(sDir)) continue;
    const entries = fs.readdirSync(sDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillFile = path.join(sDir, entry.name, 'SKILL.md');
        if (fs.existsSync(skillFile)) {
          try {
            const raw = fs.readFileSync(skillFile, 'utf8');
            const { meta, body } = parseFrontmatter(raw);

            const skillObj = {
              id: entry.name,
              name: meta.name || entry.name,
              description: meta.description || 'Specialized agentic engineering skill',
              version: meta.version || '1.0.0',
              category: meta.category || determineCategory(entry.name),
              author: meta.author || meta.source || (sDir !== SKILLS_DIR ? 'Installed' : 'Curated'),
              rawLength: raw.length,
              content: body,
              filePath: skillFile,
              source: sDir !== SKILLS_DIR ? 'installed' : 'builtin'
            };

            indexedSkills.set(entry.name.toLowerCase(), skillObj);
          } catch (e) {
            console.warn(`[SKILLS] Failed to index skill ${entry.name}:`, e.message);
          }
        }
      }
    }
  }

  profileSkillIndexes.set(pid, { skills: indexedSkills, indexedAt: now });
  return Array.from(indexedSkills.values());
}

function determineCategory(name) {
  if (name.includes('ai') || name.includes('workload')) return 'Hardware & Local AI';
  if (name.includes('code') || name.includes('coding')) return 'Code Quality';
  if (name.includes('db') || name.includes('database')) return 'Database & Systems';
  if (name.includes('security') || name.includes('auth') || name.includes('mcp')) return 'Security & Auth';
  if (name.includes('team') || name.includes('agent') || name.includes('parallel')) return 'Multi-Agent Teams';
  if (name.includes('error') || name.includes('debug')) return 'Debugging & Reliability';
  if (name.includes('test') || name.includes('playwright')) return 'Testing & QA';
  if (name.includes('optimizer') || name.includes('perf')) return 'Performance';
  return 'Engineering Craftsmanship';
}

function getSkillsCatalog(profileId = 'prof_default') {
  const skills = indexSkills(false, profileId);
  return skills.map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    sizeBytes: s.rawLength
  }));
}

function getSkill(skillId, profileId = 'prof_default') {
  if (!skillId) return null;
  const indexedSkills = new Map(indexSkills(false, profileId).map(skill => [skill.id.toLowerCase(), skill]));
  const cleanId = String(skillId).toLowerCase().trim();
  if (indexedSkills.has(cleanId)) {
    return indexedSkills.get(cleanId);
  }
  for (const [id, skill] of indexedSkills.entries()) {
    if (id.includes(cleanId) || cleanId.includes(id)) {
      return skill;
    }
  }
  return null;
}

function findRelevantSkills(prompt, profileId = 'prof_default') {
  if (!prompt || typeof prompt !== 'string') return [];
  const lower = prompt.toLowerCase();
  const indexedSkills = indexSkills(false, profileId);

  const matches = [];
  for (const skill of indexedSkills.values()) {
    const id = skill.id.toLowerCase();
    const name = skill.name.toLowerCase();
    const desc = (skill.description || '').toLowerCase();

    // 1. Direct ID / Name match
    if (lower.includes(id) || lower.includes(name)) {
      matches.push({ skill, score: 30 });
      continue;
    }

    let score = 0;

    // Token intersection for compound skill IDs (e.g. dispatching-parallel-agents, planning-with-files)
    const idTokens = id.split(/[-_]/);
    let matchedTokens = 0;
    for (const t of idTokens) {
      if (t.length >= 4 && lower.includes(t)) matchedTokens++;
    }
    if (matchedTokens >= 2) {
      score += matchedTokens * 5;
    }
    // 2. High-value category & intent matching across all 44 skill suites
    if (/\b(audit|penetration|vulnerability|exploit|security|owasp|auth|xss|injection)\b/.test(lower)) {
      if (id.includes('security') || id.includes('audit')) score += 8;
    }
    if (/\b(ui|ux|design|style|theme|color|typography|animation|framer|motion|component)\b/.test(lower)) {
      if (id.includes('ui') || id.includes('design') || id.includes('styling') || id.includes('impeccable') || id.includes('hallmark') || id.includes('taste') || id.includes('ponytail') || id.includes('anatomy') || id.includes('animate')) score += 8;
    }
    if (/\b(memory|context|pack|bundle|repomix|graph|context7|claude-mem|beads)\b/.test(lower)) {
      if (id.includes('mem') || id.includes('context') || id.includes('repo') || id.includes('graph') || id.includes('plan')) score += 8;
    }
    if (/\b(agent|subagent|swarm|workflow|kanban|router|orchestrat)\b/.test(lower)) {
      if (id.includes('agent') || id.includes('workflow') || id.includes('superpower') || id.includes('kanban') || id.includes('router') || id.includes('ecc')) score += 8;
    }
    if (/\b(token|compress|compact|save|headroom|caveman|rtk|optimize)\b/.test(lower)) {
      if (id.includes('token') || id.includes('caveman') || id.includes('rtk') || id.includes('headroom') || id.includes('compress')) score += 8;
    }
    if (/\b(react|next|nextjs|vercel|tailwind|typescript|ts)\b/.test(lower)) {
      if (id.includes('react') || id.includes('vercel') || id.includes('mattpocock') || id.includes('tailwind')) score += 7;
    }
    if (/\b(crawl|scrape|web|browser|playwright|firecrawl|navigate|fetch)\b/.test(lower)) {
      if (id.includes('playwright') || id.includes('firecrawl') || id.includes('browser') || id.includes('serena') || id.includes('crawl')) score += 7;
    }
    if (/\b(code|write|function|script|refactor|class|method)\b/.test(lower)) {
      if (id === 'senior-engineer' || id === 'efficient-coding' || id.includes('code') || id.includes('implement')) score += 5;
    }
    if (/\b(error|bug|exception|crash|failed|issue|fix)\b/.test(lower)) {
      if (id === 'error-handler' || id.includes('debug') || id.includes('diagnos')) score += 6;
    }
    if (/\b(database|sql|sqlite|schema|query|table|postgres|prisma)\b/.test(lower)) {
      if (id === 'db-sculptor' || id.includes('sql') || id.includes('database')) score += 6;
    }
    if (/\b(test|unit test|jest|pytest|qa|assert|coverage)\b/.test(lower)) {
      if (id === 'test-commander' || id.includes('test') || id.includes('qa')) score += 6;
    }

    if (score > 0) {
      matches.push({ skill, score });
    }
  }

  return matches.sort((a, b) => b.score - a.score).map(m => m.skill).slice(0, 4);
}

const SKILL_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'consult_skill',
      description: 'Consult the installed craftsmanship engineering and local AI skill library (e.g. efficient-coding, db-sculptor, local-ai-use, web-security, performance-profiler, error-handler) to ground the answer in professional standards.',
      parameters: {
        type: 'object',
        properties: {
          skill_name: {
            type: 'string',
            description: 'Name or ID of the skill to consult (e.g. "efficient-coding", "db-sculptor", "local-ai-use", "error-handler", "web-security", "test-commander")'
          }
        },
        required: ['skill_name']
      }
    }
  }
];

function executeSkillConsultation(skillName, profileId = 'prof_default') {
  const skill = getSkill(skillName, profileId);
  if (!skill) {
    const catalog = getSkillsCatalog(profileId).map(s => s.id).slice(0, 10).join(', ');
    return {
      status: 'error',
      message: `Skill "${skillName}" not found. Available skills include: ${catalog}...`
    };
  }

  const truncatedContent = skill.content.slice(0, 3000);
  return {
    status: 'success',
    skill_id: skill.id,
    skill_name: skill.name,
    category: skill.category,
    guidelines: truncatedContent
  };
}

module.exports = {
  SKILLS_DIR,
  indexSkills,
  getSkillsCatalog,
  getSkill,
  findRelevantSkills,
  SKILL_TOOLS,
  executeSkillConsultation
};
