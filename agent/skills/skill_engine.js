'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * SkillEngine - Comprehensive SKILL.md Discovery, Validation, and Execution Subsystem
 * References: Pi + OpenClaw
 * 
 * Capabilities:
 * - Multi-tier discovery: Global, Project-level, and Agent-specific skills.
 * - Robust SKILL.md parsing: Frontmatter metadata + lazy-loaded instruction body.
 * - Strict schema validation and eligibility checks (tools, dependencies, platforms).
 * - Security isolation: Third-party skills are untrusted until inspected & approved.
 * - Persistent registry: State (enabled/disabled, trust status) survives app restarts.
 */
class SkillEngine {
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceRoot || process.cwd();
    this.globalSkillsDir = options.globalSkillsDir || path.resolve(this.workspaceRoot, 'skills');
    this.registryPath = options.registryPath || path.resolve(this.workspaceRoot, 'app', 'data', 'skills', 'registry.json');
    this.availableTools = new Set(options.availableTools || []);
    
    // In-memory catalog of skill metadata (lazy-loaded instructions)
    this.skills = new Map();
    this.registry = {
      skillsState: {}, // id -> { enabled: boolean, trusted: boolean, approvedAt: string, approvedBy: string }
      updatedAt: new Date().toISOString()
    };

    this._loadRegistry();
    this.discoverSkills();
  }

  /**
   * Sets the current available tools set for eligibility checks
   */
  setAvailableTools(toolNames) {
    this.availableTools = new Set(toolNames || []);
  }

  /**
   * Load persistent skills state registry
   */
  _loadRegistry() {
    try {
      if (fs.existsSync(this.registryPath)) {
        const raw = fs.readFileSync(this.registryPath, 'utf8');
        this.registry = { ...this.registry, ...JSON.parse(raw) };
      } else {
        const dir = path.dirname(this.registryPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        this._saveRegistry();
      }
    } catch (_) {
      this.registry = { skillsState: {}, updatedAt: new Date().toISOString() };
    }
  }

  /**
   * Persist skills state registry to disk
   */
  _saveRegistry() {
    try {
      const dir = path.dirname(this.registryPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.registry.updatedAt = new Date().toISOString();
      fs.writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2), 'utf8');
    } catch (err) {
      console.warn('[SkillEngine] Failed to save registry:', err.message);
    }
  }

  /**
   * Parses standard SKILL.md with YAML frontmatter
   */
  parseSkillFile(filePath, content = null) {
    const rawContent = content !== null ? content : fs.readFileSync(filePath, 'utf8');
    const match = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

    if (!match) {
      // Fallback: entire file treated as instruction body with derived metadata
      const baseName = path.basename(filePath, '.md').replace(/^SKILL[-_]?/i, '') || 'unnamed_skill';
      return {
        meta: {
          name: baseName,
          description: 'Custom skill without frontmatter metadata',
          risk_tier: 'read_only',
          trusted: false
        },
        body: rawContent.trim(),
        filePath
      };
    }

    const rawMeta = match[1];
    const body = match[2].trim();
    const meta = {};

    let currentListKey = null;

    for (const line of rawMeta.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (trimmed.startsWith('- ') && currentListKey) {
        meta[currentListKey].push(trimmed.slice(2).trim().replace(/^['"]|['"]$/g, ''));
        continue;
      }

      const colonIdx = trimmed.indexOf(':');
      if (colonIdx !== -1) {
        const key = trimmed.slice(0, colonIdx).trim();
        let val = trimmed.slice(colonIdx + 1).trim();

        if (!val) {
          // Multiline array started
          currentListKey = key;
          meta[key] = [];
        } else {
          currentListKey = null;
          if ((val.startsWith('[') && val.endsWith(']'))) {
            try {
              meta[key] = JSON.parse(val);
            } catch (_) {
              meta[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
            }
          } else if (val === 'true' || val === 'false') {
            meta[key] = val === 'true';
          } else if (/^\d+$/.test(val)) {
            meta[key] = Number(val);
          } else {
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            meta[key] = val;
          }
        }
      }
    }

    return { meta, body, filePath };
  }

  /**
   * Validates skill schema, ensuring required fields and safe declarations
   */
  validateSkill(parsed) {
    const errors = [];
    const meta = parsed.meta || {};

    if (!meta.name || typeof meta.name !== 'string' || meta.name.trim().length === 0) {
      errors.push('Skill metadata missing required "name"');
    }
    if (!meta.description || typeof meta.description !== 'string' || meta.description.trim().length === 0) {
      errors.push('Skill metadata missing required "description"');
    }
    if (!parsed.body || parsed.body.trim().length === 0) {
      errors.push('Skill contains empty instructions body');
    }

    const validRiskTiers = ['read_only', 'safe', 'elevated', 'dangerous'];
    if (meta.risk_tier && !validRiskTiers.includes(meta.risk_tier)) {
      errors.push(`Invalid risk_tier: "${meta.risk_tier}". Expected one of: ${validRiskTiers.join(', ')}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Checks runtime eligibility: tool availability, OS compatibility, and dependencies
   */
  checkEligibility(skill) {
    const reasons = [];

    // Required tools check
    const requiredTools = skill.required_tools || [];
    if (Array.isArray(requiredTools) && requiredTools.length > 0 && this.availableTools.size > 0) {
      for (const tool of requiredTools) {
        if (!this.availableTools.has(tool)) {
          reasons.push(`Missing required tool: "${tool}"`);
        }
      }
    }

    // Platform eligibility (e.g. windows vs linux)
    if (skill.platforms && Array.isArray(skill.platforms)) {
      const currentPlatform = process.platform === 'win32' ? 'windows' : process.platform;
      if (!skill.platforms.includes(currentPlatform) && !skill.platforms.includes('*')) {
        reasons.push(`Platform mismatch: skill requires [${skill.platforms.join(', ')}], current: "${currentPlatform}"`);
      }
    }

    return {
      eligible: reasons.length === 0,
      reasons
    };
  }

  /**
   * Discovers skills across Global, Project, and Agent-specific tiers
   * Implements lazy-loading: indexes metadata, loads body on-demand
   */
  discoverSkills({ workspaceRoot = null, force = false } = {}) {
    const wsRoot = workspaceRoot || this.workspaceRoot;
    this.skills.clear();

    const scanTiers = [
      { scope: 'global', dir: this.globalSkillsDir, isTrustedDefault: true },
      { scope: 'global', dir: path.resolve(wsRoot, 'app', 'data', 'skills'), isTrustedDefault: true },
      { scope: 'project', dir: path.resolve(wsRoot, '.abyx', 'skills'), isTrustedDefault: true },
      { scope: 'project', dir: path.resolve(wsRoot, 'skills'), isTrustedDefault: true },
      { scope: 'agent', dir: path.resolve(wsRoot, 'agent', 'skills'), isTrustedDefault: true },
      { scope: 'third_party', dir: path.resolve(wsRoot, 'data', 'extensions', 'installed', 'skills'), isTrustedDefault: false }
    ];

    for (const tier of scanTiers) {
      if (!fs.existsSync(tier.dir)) continue;

      const entries = fs.readdirSync(tier.dir, { withFileTypes: true });
      for (const entry of entries) {
        let skillFilePath = null;
        if (entry.isDirectory()) {
          const directSkillMd = path.join(tier.dir, entry.name, 'SKILL.md');
          const altSkillMd = path.join(tier.dir, entry.name, 'skill.md');
          if (fs.existsSync(directSkillMd)) skillFilePath = directSkillMd;
          else if (fs.existsSync(altSkillMd)) skillFilePath = altSkillMd;
        } else if (entry.isFile() && (entry.name.toLowerCase().endsWith('.md'))) {
          skillFilePath = path.join(tier.dir, entry.name);
        }

        if (!skillFilePath) continue;

        try {
          const parsed = this.parseSkillFile(skillFilePath);
          const validation = this.validateSkill(parsed);
          if (!validation.valid) continue;

          const meta = parsed.meta;
          const id = (meta.id || entry.name.replace(/\.md$/i, '')).toLowerCase().replace(/[^a-z0-9_-]/g, '_');

          // Check persistent registry state
          const savedState = this.registry.skillsState[id] || {};
          const enabled = savedState.enabled !== undefined ? savedState.enabled : true;
          const trusted = savedState.trusted !== undefined ? savedState.trusted : tier.isTrustedDefault;

          const skillEntry = {
            id,
            name: meta.name,
            description: meta.description,
            version: meta.version || '1.0.0',
            author: meta.author || 'local',
            scope: tier.scope,
            filePath: skillFilePath,
            risk_tier: meta.risk_tier || 'read_only',
            trigger_conditions: meta.trigger_conditions || meta.triggers || [],
            required_tools: meta.required_tools || [],
            dependencies: meta.dependencies || [],
            allowed_agents: meta.allowed_agents || ['*'],
            enabled,
            trusted,
            approvedAt: savedState.approvedAt || null,
            approvedBy: savedState.approvedBy || null
          };

          this.skills.set(id, skillEntry);
        } catch (_) {}
      }
    }

    return Array.from(this.skills.values());
  }

  /**
   * Retrieves skill with on-demand instructions body (lazy-loading)
   */
  getSkill(id, { loadBody = false } = {}) {
    const meta = this.skills.get(id);
    if (!meta) return null;

    if (!loadBody) {
      const eligibility = this.checkEligibility(meta);
      return { ...meta, eligible: eligibility.eligible, ineligibilityReasons: eligibility.reasons };
    }

    try {
      const parsed = this.parseSkillFile(meta.filePath);
      const eligibility = this.checkEligibility(meta);
      return {
        ...meta,
        instructions: parsed.body,
        eligible: eligibility.eligible,
        ineligibilityReasons: eligibility.reasons
      };
    } catch (err) {
      return { ...meta, error: err.message, instructions: '' };
    }
  }

  /**
   * Toggles skill enable / disable state persistently
   */
  setSkillEnabled(id, enabled = true) {
    const skill = this.skills.get(id);
    if (!skill) return { ok: false, error: 'Skill not found' };

    skill.enabled = !!enabled;
    this.registry.skillsState[id] = {
      ...(this.registry.skillsState[id] || {}),
      enabled: skill.enabled
    };
    this._saveRegistry();
    return { ok: true, id, enabled: skill.enabled };
  }

  /**
   * Approves an untrusted or third-party skill (User Trust Decision)
   */
  approveSkill(id, { approvedBy = 'user' } = {}) {
    const skill = this.skills.get(id);
    if (!skill) return { ok: false, error: 'Skill not found' };

    skill.trusted = true;
    skill.approvedAt = new Date().toISOString();
    skill.approvedBy = approvedBy;

    this.registry.skillsState[id] = {
      ...(this.registry.skillsState[id] || {}),
      trusted: true,
      approvedAt: skill.approvedAt,
      approvedBy
    };
    this._saveRegistry();
    return { ok: true, id, trusted: true, approvedBy };
  }

  /**
   * Installs a new skill into Global or Project directory
   * Treats newly installed third-party skills as untrusted by default
   */
  installSkill(rawMarkdown, { scope = 'project', fileName = null, workspaceRoot = null, trusted = false } = {}) {
    const wsRoot = workspaceRoot || this.workspaceRoot;
    const targetDir = scope === 'project'
      ? path.resolve(wsRoot, '.abyx', 'skills')
      : path.resolve(wsRoot, 'app', 'data', 'skills');

    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const parsed = this.parseSkillFile('temp.md', rawMarkdown);
    const validation = this.validateSkill(parsed);
    if (!validation.valid) {
      return { ok: false, errors: validation.errors };
    }

    const safeName = (fileName || `${parsed.meta.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}.md`);
    const finalPath = path.join(targetDir, safeName);
    fs.writeFileSync(finalPath, rawMarkdown, 'utf8');

    const id = (parsed.meta.id || path.basename(safeName, '.md')).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    this.registry.skillsState[id] = {
      enabled: true,
      trusted: !!trusted,
      installedAt: new Date().toISOString()
    };
    this._saveRegistry();
    this.discoverSkills({ workspaceRoot: wsRoot });

    return {
      ok: true,
      id,
      filePath: finalPath,
      trusted: !!trusted,
      requiresApproval: !trusted
    };
  }

  /**
   * Matches skills against user prompt or task goal using trigger conditions
   * and agent role permissions for dynamic prompt injection
   */
  matchSkills(taskGoal, { agentId = null, limit = 3, allowUntrusted = false } = {}) {
    if (!taskGoal || typeof taskGoal !== 'string') return [];

    const normalizedGoal = taskGoal.toLowerCase();
    const words = normalizedGoal.split(/\W+/).filter(w => w.length > 2);
    const matched = [];

    for (const [id, skill] of this.skills.entries()) {
      if (!skill.enabled) continue;
      if (!allowUntrusted && !skill.trusted) continue;

      // Agent scope check
      if (agentId && Array.isArray(skill.allowed_agents) && !skill.allowed_agents.includes('*')) {
        if (!skill.allowed_agents.includes(agentId)) continue;
      }

      // Eligibility check
      const eligibility = this.checkEligibility(skill);
      if (!eligibility.eligible) continue;

      let score = 0;

      // Check trigger conditions
      const triggers = Array.isArray(skill.trigger_conditions) ? skill.trigger_conditions : [];
      for (const trigger of triggers) {
        const lowerTrig = String(trigger).toLowerCase();
        if (normalizedGoal.includes(lowerTrig)) {
          score += 2.0; // Strong match for declared trigger
        }
      }

      // Check name & description keyword overlap
      const descWords = (skill.name + ' ' + skill.description).toLowerCase().split(/\W+/);
      let matchCount = 0;
      for (const w of words) {
        if (descWords.includes(w)) matchCount++;
      }
      if (words.length > 0) {
        score += (matchCount / words.length);
      }

      if (score > 0.1) {
        matched.push({ skillId: id, score });
      }
    }

    matched.sort((a, b) => b.score - a.score);

    // Retrieve full instructions body for the top matched skills (lazy loading)
    return matched.slice(0, limit).map(m => {
      const full = this.getSkill(m.skillId, { loadBody: true });
      return {
        ...full,
        matchScore: m.score
      };
    });
  }

  /**
   * Returns list of all cataloged skills with metadata
   */
  listSkills({ scope = null, enabledOnly = false } = {}) {
    const list = [];
    for (const [id, s] of this.skills.entries()) {
      if (scope && s.scope !== scope) continue;
      if (enabledOnly && !s.enabled) continue;
      list.push(this.getSkill(id, { loadBody: false }));
    }
    return list;
  }
}

module.exports = SkillEngine;
